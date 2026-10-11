import { mkdirSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { subtitleWindowRange } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { subtitleFileArgs, subtitleWindowArgs } from '@/ffmpeg/args'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import type { MediaRecord } from '@/media/mediaRepository'
import { TracksService } from '@/playback/tracksService'

/** Most sidecars that are not UTF-8 are Windows Latin-1, from the DVD-rip years. */
const FALLBACK_CHARSET = 'CP1252'

/**
 * Subtitles as WebVTT, cached on disk under `<data>/subtitles/<id>/`.
 * Embedded tracks are extracted one window at a time (see
 * `subtitleWindowRange`), so the first cues arrive after reading minutes
 * of the file rather than all of it; sidecar files are converted whole.
 * Cache names carry the file's mtime, and a new version clears the old.
 */
@Injectable()
export class SubtitlesService {
  private readonly dir: string
  private readonly running = new Map<string, Promise<string>>()

  constructor(
    @Inject(SERVER_CONFIG) config: ServerConfig,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(TracksService) private readonly tracks: TracksService,
  ) {
    this.dir = join(config.dataDir, 'subtitles')
    mkdirSync(this.dir, { recursive: true })
  }

  /** One track's WebVTT; for an embedded track, only window `window`. */
  async vtt({
    record,
    trackId,
    window,
  }: {
    record: MediaRecord
    trackId: string
    window: number
  }): Promise<string> {
    const { tracks, sidecars } = await this.tracks.tracksFor(record)
    const track = tracks.subtitles.find((candidate) => candidate.id === trackId)
    if (!track) throw new NotFoundException(`No subtitle track ${trackId}`)
    if (!track.supported) {
      throw new UnprocessableEntityException(
        'This subtitle track is a picture of text, which browsers cannot show.',
      )
    }
    const number = Number(trackId.split('-')[1])
    const sidecar = track.source === 'external' ? sidecars[number] : undefined
    const part = sidecar ? 'all' : String(window)
    const folder = join(this.dir, String(record.id))
    const path = join(folder, `${record.mtimeMs}-${trackId}-${part}.vtt`)

    const cached = await readFile(path, 'utf8').catch(() => null)
    if (cached != null) return cached

    const running = this.running.get(path)
    if (running) return running
    const work = this.extract({
      folder,
      path,
      version: String(record.mtimeMs),
      args: (output) =>
        sidecar
          ? [
              subtitleFileArgs({ input: sidecar.path, output, charset: null }),
              subtitleFileArgs({ input: sidecar.path, output, charset: FALLBACK_CHARSET }),
            ]
          : [
              subtitleWindowArgs({
                input: record.path,
                stream: number,
                ...subtitleWindowRange(window),
                output,
              }),
            ],
    }).finally(() => this.running.delete(path))
    this.running.set(path, work)
    return work
  }

  /** Forget media that is gone, along with every cached track. */
  async discard(ids: readonly number[]): Promise<void> {
    await Promise.all(
      ids.map((id) => rm(join(this.dir, String(id)), { recursive: true, force: true })),
    )
  }

  /**
   * Runs each argument list in turn until one works, writing aside and
   * renaming into place so a half-written file is never served.
   */
  private async extract({
    folder,
    path,
    version,
    args,
  }: {
    folder: string
    path: string
    version: string
    args: (output: string) => string[][]
  }): Promise<string> {
    await mkdir(folder, { recursive: true })
    await this.clearOtherVersions({ folder, version })
    // ffmpeg picks the muxer from the extension too, so the temp file keeps .vtt.
    const temp = `${path}.${process.pid}-${Math.random().toString(36).slice(2)}.vtt`
    const attempts = args(temp)
    try {
      await attempts.reduce<Promise<boolean>>(
        (done, attempt, index) =>
          done.then((finished) =>
            finished
              ? true
              : this.ffmpeg.exec(attempt).then(
                  () => true,
                  (error: unknown) =>
                    index === attempts.length - 1 ? Promise.reject(error) : false,
                ),
          ),
        Promise.resolve(false),
      )
      await rename(temp, path)
      return await readFile(path, 'utf8')
    } finally {
      await rm(temp, { force: true })
    }
  }

  private async clearOtherVersions({
    folder,
    version,
  }: {
    folder: string
    version: string
  }): Promise<void> {
    const names = await readdir(folder).catch(() => [])
    await Promise.all(
      names
        .filter((name) => !name.startsWith(`${version}-`))
        .map((name) => rm(join(folder, name), { force: true })),
    )
  }
}
