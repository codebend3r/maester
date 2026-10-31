import { mkdirSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import type { AudioBitrate } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { audioTranscodeArgs } from '@/ffmpeg/args'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { MediaIndex } from '@/media/mediaIndex'
import { type Gate, createGate } from '@/scanner/concurrency'

const SWEEP_MS = 6 * 60 * 60 * 1000

/** A dot-file older than this was left by a run the server never finished, such as one cut by a restart. */
const ABANDONED_MS = 24 * 60 * 60 * 1000

const EXTENSION = 'm4a'

const MEDIA_FOLDER = /^\d+$/

type Cached = { path: string; size: number; servedAt: number }

type TranscodeCacheFileForProps = {
  mediaId: number
  /** The track's file, read only. */
  path: string
  /** The track's mtime as the index holds it, which names the version made of it. */
  mtimeMs: number
  kbps: AudioBitrate
}

type TranscodeCacheOnceProps = { key: string; make: () => Promise<string> }

type TranscodeCacheMakeProps = { source: string; dir: string; target: string; kbps: AudioBitrate }

type TranscodeCacheKeptProps = { dir: string; now: number }

/**
 * Tracks converted to AAC for offline downloads and cellular streaming, on
 * disk as `transcodes/<mediaId>/<mtimeMs>-<kbps>.m4a`. Each is made on first
 * ask and served from disk after; a file that changes gets new ones, and the
 * old go. Past `transcodeCacheBytes` the least recently served go first, by
 * the sweep at start and every six hours, which also drops the folders of
 * media no longer indexed.
 */
@Injectable()
export class TranscodeCache implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TranscodeCache.name)
  private readonly root: string
  private readonly cap: number
  private readonly working = new Map<string, Promise<string>>()
  // Encoding takes CPU the server shares with video transcodes, and a download asks for an album at once.
  private readonly encodes: Gate = createGate({ limit: 2 })
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(SERVER_CONFIG) config: ServerConfig,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaIndex) private readonly index: Pick<MediaIndex, 'fileOf'>,
  ) {
    this.root = join(config.dataDir, 'transcodes')
    this.cap = config.transcodeCacheBytes
    mkdirSync(this.root, { recursive: true })
  }

  onApplicationBootstrap(): void {
    const sweep = () =>
      this.sweep().catch((error: unknown) =>
        this.logger.warn(`Could not sweep the transcodes: ${errorMessage(error)}`),
      )
    void sweep()
    this.timer = setInterval(sweep, SWEEP_MS)
    this.timer.unref()
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    await Promise.allSettled(this.working.values())
  }

  /** Runs `make` once per key at a time; later callers wait on the same promise. */
  private once({ key, make }: TranscodeCacheOnceProps): Promise<string> {
    const running = this.working.get(key)
    if (running) return running
    const started = make().finally(() => this.working.delete(key))
    this.working.set(key, started)
    return started
  }

  /**
   * The track at `kbps`, made once and marked as served now, so the sweep
   * keeps it over files served longer ago. Rejects when ffmpeg cannot read it.
   */
  async fileFor({ mediaId, path, mtimeMs, kbps }: TranscodeCacheFileForProps): Promise<string> {
    const dir = join(this.root, String(mediaId))
    const version = `${Math.round(mtimeMs)}-`
    const target = join(dir, `${version}${kbps}.${EXTENSION}`)
    const made = await this.once({
      key: target,
      make: async () => {
        const existing = await stat(target).catch(() => null)
        if (existing?.isFile()) return target
        await this.make({ source: path, dir, target, kbps })
        const files = await readdir(dir).catch((): string[] => [])
        await Promise.all(
          files
            .filter((file) => !file.startsWith('.') && !file.startsWith(version))
            .map((file) => rm(join(dir, file), { force: true })),
        )
        return target
      },
    })
    const info = await stat(made)
    // The name holds the version, so the mtime is left as it is and only the atime says when it was served.
    await utimes(made, new Date(), info.mtime)
    return made
  }

  private async make({ source, dir, target, kbps }: TranscodeCacheMakeProps): Promise<void> {
    await mkdir(dir, { recursive: true })
    const temp = join(
      dir,
      `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${EXTENSION}`,
    )
    try {
      await this.encodes.run(() =>
        this.ffmpeg.exec(audioTranscodeArgs({ input: source, output: temp, kbps })),
      )
      await rename(temp, target)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  /**
   * Removes the folders of media no longer indexed, then the least recently
   * served files until what is left fits the cap. The most recently served
   * one always stays, even when it alone is past the cap.
   */
  async sweep(): Promise<void> {
    const now = Date.now()
    const folders = await readdir(this.root).catch((): string[] => [])
    const kept = await Promise.all(
      folders.map(async (name) => {
        const dir = join(this.root, name)
        if (MEDIA_FOLDER.test(name) && this.index.fileOf(Number(name)) !== null) {
          return this.kept({ dir, now })
        }
        await rm(dir, { recursive: true, force: true })
        return []
      }),
    )
    const { evicted } = kept
      .flat()
      .toSorted((a, b) => b.servedAt - a.servedAt)
      .reduce<{ total: number; evicted: Cached[] }>(
        ({ total, evicted: before }, file, at) => {
          const after = total + file.size
          return { total: after, evicted: at > 0 && after > this.cap ? [...before, file] : before }
        },
        { total: 0, evicted: [] },
      )
    await Promise.all(evicted.map(({ path }) => rm(path, { force: true })))
  }

  /** The finished files in one media's folder, after removing the dot-files runs abandoned. */
  private async kept({ dir, now }: TranscodeCacheKeptProps): Promise<Cached[]> {
    const names = await readdir(dir).catch((): string[] => [])
    const files = await Promise.all(
      names.map(async (name): Promise<Cached[]> => {
        const path = join(dir, name)
        const info = await stat(path).catch(() => null)
        if (!info?.isFile()) return []
        if (!name.startsWith('.')) return [{ path, size: info.size, servedAt: info.atimeMs }]
        if (now - info.mtimeMs > ABANDONED_MS) await rm(path, { force: true })
        return []
      }),
    )
    return files.flat()
  }
}
