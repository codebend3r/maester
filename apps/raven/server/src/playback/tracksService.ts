import { Inject, Injectable } from '@nestjs/common'
import type { MediaTracks, SubtitleTrack } from '@raven/core'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseTracks } from '@/ffmpeg/tracks'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { type Sidecar, findSidecars } from '@/playback/sidecars'

/** The tracks a client sees, plus where each sidecar lives, which it never does. */
export type ResolvedTracks = {
  tracks: MediaTracks
  /** By `external-N` index. */
  sidecars: Sidecar[]
}

/** Probing a file again picks up sidecars added since; a file that changed is keyed afresh. */
const CACHE_MS = 10 * 60 * 1000
const CACHE_LIMIT = 200

type SidecarTrackProps = { sidecar: Sidecar; index: number }

const sidecarTrack = ({ sidecar, index }: SidecarTrackProps): SubtitleTrack => ({
  id: `external-${index}`,
  source: 'external',
  codec: sidecar.codec,
  language: sidecar.language,
  title: sidecar.title,
  default: false,
  forced: sidecar.forced,
  hearingImpaired: sidecar.hearingImpaired,
  supported: true,
})

/**
 * The audio and subtitle tracks of a file. The scan's probe stores the
 * embedded ones in the index, so opening a video runs no ffprobe: over a
 * share that probe reads the same file the player is waiting on. A video
 * the scan has not probed yet, or probed before tracks were stored, is
 * probed on its first play and kept; the next scan stores the rest. Sidecar
 * files are looked up each time, since one can appear without the video
 * changing. The whole answer is cached in memory per file version for a few
 * minutes.
 */
@Injectable()
export class TracksService {
  private readonly cache = new Map<string, { at: number; tracks: Promise<ResolvedTracks> }>()

  constructor(
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaIndex) private readonly index: MediaIndex,
  ) {}

  tracksFor(file: MediaFile): Promise<ResolvedTracks> {
    const key = `${file.id}:${file.mtimeMs}`
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.tracks

    const tracks = this.read(file)
    this.cache.delete(key)
    this.cache.set(key, { at: Date.now(), tracks })
    // A Map keeps insertion order, so the first key is the oldest.
    const oldest = this.cache.size > CACHE_LIMIT ? this.cache.keys().next().value : undefined
    if (oldest != null) this.cache.delete(oldest)
    // A failure is not worth remembering: the share may just have been asleep.
    tracks.catch(() => this.cache.delete(key))
    return tracks
  }

  /** Forgets what is cached of media that is gone. */
  forget(ids: readonly number[]): void {
    const gone = new Set(ids.map(String))
    Array.from(this.cache.keys())
      .filter((key) => gone.has(key.slice(0, key.indexOf(':'))))
      .forEach((key) => this.cache.delete(key))
  }

  /** The stored tracks, or a probe's, kept for next time. */
  private async embedded(file: MediaFile): Promise<MediaTracks> {
    const stored = this.index.storedTracks(file.id)
    if (stored) return stored
    const tracks = parseTracks(await this.ffmpeg.probeJson(file.path))
    this.index.saveTracks({ id: file.id, tracks })
    return tracks
  }

  private async read(file: MediaFile): Promise<ResolvedTracks> {
    const [embedded, sidecars] = await Promise.all([this.embedded(file), findSidecars(file.path)])
    return {
      tracks: {
        ...embedded,
        subtitles: [
          ...embedded.subtitles,
          ...sidecars.map((sidecar, index) => sidecarTrack({ sidecar, index })),
        ],
      },
      sidecars,
    }
  }
}
