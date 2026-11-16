import { mkdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  type PictureCue,
  SUBTITLE_SOURCES,
  isOverlaySubtitle,
  isPictureCues,
  subtitleWindowRange,
} from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { pictureWindowArgs, subtitleFileArgs, subtitleWindowArgs } from '@/ffmpeg/args'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import type { MediaFile } from '@/media/mediaIndex'
import { pictureCuesOf } from '@/playback/pictureCues'
import { TracksService } from '@/playback/tracksService'
import { removeFiles } from '@/fileSweep'

/** Most sidecars that are not UTF-8 are Windows Latin-1, from the DVD-rip years. */
const FALLBACK_CHARSET = 'CP1252'

type SubtitlesServiceVttProps = {
  file: MediaFile
  trackId: string
  window: number
}

/** How a track's cues are answered: text as WebVTT, a picture track's as its timed pictures. */
export const CUE_KINDS = { text: 'text', pictures: 'pictures' } as const

/** One window of a track's cues, in the form the track has. */
export type TrackCues =
  | { kind: typeof CUE_KINDS.text; vtt: string }
  | { kind: typeof CUE_KINDS.pictures; cues: PictureCue[] }

type CachedPicturesProps = { path: string }

/** A window's picture cues as they were cached, or null when the file is missing or not understood. */
const cachedPictures = async ({ path }: CachedPicturesProps): Promise<PictureCue[] | null> => {
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  try {
    const cues: unknown = JSON.parse(text)
    return isPictureCues(cues) ? cues : null
  } catch {
    return null
  }
}

type SubtitlesServiceExtractProps = {
  folder: string
  path: string
  version: string
  /** The names this one replaces under the same media version: a sidecar's older copies. */
  supersedes: string | null
  args: (output: string) => string[][]
}

type SubtitlesServiceClearStaleProps = Omit<SubtitlesServiceExtractProps, 'args'>

type SubtitlesServiceDrawProps = SubtitlesServiceVttProps & { folder: string; path: string }

/**
 * Subtitles as WebVTT, cached on disk under `<data>/subtitles/<id>/`.
 * Embedded tracks are extracted one window at a time (see
 * `subtitleWindowRange`), so the first cues arrive after reading minutes
 * of the file rather than all of it; sidecar files are converted whole.
 * Cache names carry the file's mtime, and a new version clears the old. A
 * sidecar's also carry its own, so a sidecar retimed or replaced beside an
 * unchanged video is converted again rather than served as it was. A picture track the server
 * can read (Blu-ray PGS) is cached the same way, a window of timed pictures as JSON.
 */
@Injectable()
export class SubtitlesService {
  private readonly dir: string
  private readonly running = new Map<string, Promise<string>>()
  private readonly drawing = new Map<string, Promise<PictureCue[]>>()

  constructor(
    @Inject(SERVER_CONFIG) config: ServerConfig,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(TracksService) private readonly tracks: TracksService,
  ) {
    this.dir = join(config.dataDir, 'subtitles')
    mkdirSync(this.dir, { recursive: true })
  }

  /**
   * One window of a track's cues: WebVTT for text, and the timed pictures of a picture track the
   * server can read, which a player that draws its own subtitles lays over the video.
   */
  async cues(props: SubtitlesServiceVttProps): Promise<TrackCues> {
    const { tracks } = await this.tracks.tracksFor(props.file)
    const track = tracks.subtitles.find((candidate) => candidate.id === props.trackId) ?? null
    return isOverlaySubtitle(track)
      ? { kind: CUE_KINDS.pictures, cues: await this.pictures(props) }
      : { kind: CUE_KINDS.text, vtt: await this.vtt(props) }
  }

  /** One window of a picture track, read from the disc's own segments and cached as JSON. */
  private async pictures({
    file,
    trackId,
    window,
  }: SubtitlesServiceVttProps): Promise<PictureCue[]> {
    if (!Number.isSafeInteger(window) || window < 0) {
      throw new NotFoundException('Invalid subtitle track or window')
    }
    const folder = join(this.dir, String(file.id))
    const path = join(folder, `${file.mtimeMs}-${trackId}-${window}.json`)
    const cached = await cachedPictures({ path })
    if (cached !== null) return cached

    const running = this.drawing.get(path)
    if (running) return running
    const work = this.draw({ file, trackId, window, folder, path }).finally(() =>
      this.drawing.delete(path),
    )
    this.drawing.set(path, work)
    return work
  }

  private async draw({
    file,
    trackId,
    window,
    folder,
    path,
  }: SubtitlesServiceDrawProps): Promise<PictureCue[]> {
    await mkdir(folder, { recursive: true })
    await this.clearStale({ folder, path, version: String(file.mtimeMs), supersedes: null })
    const range = subtitleWindowRange(window)
    // ffmpeg picks the muxer from the extension too, so the segments' file is a .sup.
    const temp = `${path}.${process.pid}-${Math.random().toString(36).slice(2)}`
    const segments = `${temp}.sup`
    try {
      await this.ffmpeg.exec({
        args: pictureWindowArgs({
          input: file.path,
          stream: Number(trackId.split('-')[1]),
          ...range,
          output: segments,
        }),
      })
      const cues = pictureCuesOf({
        sup: await readFile(segments),
        end: range.start + range.duration,
        isHdr: file.hdr,
      })
      await writeFile(temp, JSON.stringify(cues))
      await rename(temp, path)
      return cues
    } finally {
      await Promise.all([rm(segments, { force: true }), rm(temp, { force: true })])
    }
  }

  /** One track's WebVTT; for an embedded track, only window `window`. */
  async vtt({ file, trackId, window }: SubtitlesServiceVttProps): Promise<string> {
    if (!/^(embedded|external)-\d+$/.test(trackId) || !Number.isSafeInteger(window) || window < 0) {
      throw new NotFoundException('Invalid subtitle track or window')
    }
    const { tracks, sidecars } = await this.tracks.tracksFor(file)
    const track = tracks.subtitles.find((candidate) => candidate.id === trackId)
    if (!track) throw new NotFoundException(`No subtitle track ${trackId}`)
    if (!track.supported) {
      throw new UnprocessableEntityException(
        'This subtitle track is a picture of text, which browsers cannot show.',
      )
    }
    const number = Number(trackId.split('-')[1])
    const sidecar = track.source === SUBTITLE_SOURCES.external ? sidecars[number] : undefined
    const folder = join(this.dir, String(file.id))
    const trackName = `${file.mtimeMs}-${trackId}-`
    const part = sidecar ? `all.${Math.floor((await stat(sidecar.path)).mtimeMs)}` : String(window)
    const path = join(folder, `${trackName}${part}.vtt`)

    const cached = await readFile(path, 'utf8').catch(() => null)
    if (cached != null) return cached

    const running = this.running.get(path)
    if (running) return running
    const work = this.extract({
      folder,
      path,
      version: String(file.mtimeMs),
      supersedes: sidecar ? `${trackName}all` : null,
      args: (output) =>
        sidecar
          ? [
              subtitleFileArgs({ input: sidecar.path, output, charset: null }),
              subtitleFileArgs({ input: sidecar.path, output, charset: FALLBACK_CHARSET }),
            ]
          : [
              subtitleWindowArgs({
                input: file.path,
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
    supersedes,
    args,
  }: SubtitlesServiceExtractProps): Promise<string> {
    await mkdir(folder, { recursive: true })
    await this.clearStale({ folder, path, version, supersedes })
    // ffmpeg picks the muxer from the extension too, so the temp file keeps .vtt.
    const temp = `${path}.${process.pid}-${Math.random().toString(36).slice(2)}.vtt`
    const attempts = args(temp)
    try {
      await attempts.reduce<Promise<boolean>>(
        (done, attempt, index) =>
          done.then((finished) =>
            finished
              ? true
              : this.ffmpeg.exec({ args: attempt }).then(
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

  private async clearStale({
    folder,
    path,
    version,
    supersedes,
  }: SubtitlesServiceClearStaleProps): Promise<void> {
    const kept = basename(path)
    const isStale = (name: string) =>
      !name.startsWith(`${version}-`) ||
      (supersedes !== null && name.startsWith(supersedes) && !name.startsWith(kept))
    await removeFiles({ dir: folder, isGone: isStale })
  }
}
