import { Inject, Injectable } from '@nestjs/common'
import type { MediaTracks, SubtitleTrack } from '@raven/core'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseTracks } from '@/ffmpeg/tracks'
import { type MediaRecord, MediaRepository } from '@/media/mediaRepository'
import { type Sidecar, findSidecars } from '@/playback/sidecars'
import { type TaskQueue, createTaskQueue } from '@/scanner/concurrency'

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
 * The audio and subtitle tracks of a file. The scan's probe stores the
 * embedded ones in the index, so opening a video runs no ffprobe: over a
 * share that probe reads the same file the player is waiting on. A video
 * indexed before tracks were stored is probed on its first play and kept,
 * and `backfill` fills the rest in the background. Sidecar files are looked
 * up each time, since one can appear without the video changing. The whole
 * answer is cached in memory per file version for a few minutes.
 */
@Injectable()
export class TracksService {
  private readonly cache = new Map<string, { at: number; tracks: Promise<ResolvedTracks> }>()
  /** One at a time: the backfill should never crowd out a player. */
  private readonly queue: TaskQueue = createTaskQueue({ concurrency: 1 })

  constructor(
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaRepository) private readonly media: MediaRepository,
  ) {}

  tracksFor(record: MediaRecord): Promise<ResolvedTracks> {
    const key = `${record.id}:${record.mtimeMs}`
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.tracks

    const tracks = this.read(record)
    this.cache.delete(key)
    this.cache.set(key, { at: Date.now(), tracks })
    // A Map keeps insertion order, so the first key is the oldest.
    const oldest = this.cache.size > CACHE_LIMIT ? this.cache.keys().next().value : undefined
    if (oldest != null) this.cache.delete(oldest)
    // A failure is not worth remembering: the share may just have been asleep.
    tracks.catch(() => this.cache.delete(key))
    return tracks
  }

  /** Probes, in the background and one at a time, the videos with no stored tracks. */
  backfill(ids: readonly number[]): void {
    ids.forEach((id) =>
      this.queue.push(String(id), async () => {
        const record = this.media.get(id)
        if (!record || this.media.storedTracks(id)) return
        await this.embedded(record)
      }),
    )
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  /** The stored tracks, or a probe's, kept for next time. */
  private async embedded(record: MediaRecord): Promise<MediaTracks> {
    const stored = this.media.storedTracks(record.id)
    if (stored) return stored
    const tracks = parseTracks(await this.ffmpeg.probeJson(record.path))
    this.media.saveTracks({ id: record.id, tracks })
    return tracks
  }

  private async read(record: MediaRecord): Promise<ResolvedTracks> {
    const [file, sidecars] = await Promise.all([this.embedded(record), findSidecars(record.path)])
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
