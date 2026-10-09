import { Inject, Injectable } from '@nestjs/common'
import type { MediaTracks, SubtitleTrack } from '@raven/core'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseTracks } from '@/ffmpeg/tracks'
import type { MediaRecord } from '@/media/mediaRepository'
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

const sidecarTrack = ({ sidecar, index }: { sidecar: Sidecar; index: number }): SubtitleTrack => ({
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
 * The audio and subtitle tracks of a file, read with ffprobe when the
 * player opens it rather than kept in the index: one probe per play is
 * cheap, and existing libraries need no rescan. Cached in memory per file
 * version for a few minutes.
 */
@Injectable()
export class TracksService {
  private readonly cache = new Map<string, { at: number; tracks: Promise<ResolvedTracks> }>()

  constructor(@Inject(FfmpegService) private readonly ffmpeg: FfmpegService) {}

  tracksFor(record: MediaRecord): Promise<ResolvedTracks> {
    const key = `${record.id}:${record.mtimeMs}`
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.tracks

    const tracks = this.read(record.path)
    this.cache.delete(key)
    this.cache.set(key, { at: Date.now(), tracks })
    // A Map keeps insertion order, so the first key is the oldest.
    const oldest = this.cache.size > CACHE_LIMIT ? this.cache.keys().next().value : undefined
    if (oldest != null) this.cache.delete(oldest)
    // A failure is not worth remembering: the share may just have been asleep.
    tracks.catch(() => this.cache.delete(key))
    return tracks
  }

  private async read(path: string): Promise<ResolvedTracks> {
    const [probe, sidecars] = await Promise.all([this.ffmpeg.probeJson(path), findSidecars(path)])
    const file = parseTracks(probe)
    return {
      tracks: {
        ...file,
        subtitles: [
          ...file.subtitles,
          ...sidecars.map((sidecar, index) => sidecarTrack({ sidecar, index })),
        ],
      },
      sidecars,
    }
  }
}
