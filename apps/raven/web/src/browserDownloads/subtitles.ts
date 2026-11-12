import {
  formatWebVtt,
  isMediaItem,
  isPictureSubtitle,
  parseWebVtt,
  SUBTITLE_SOURCES,
  type SubtitleCue,
  type SubtitleTrack,
  subtitleWindowOf,
} from '@raven/core'
import type { DownloadDisk } from '@/browserDownloads/disk'
import { type BrowserEntry, type SavedSubtitle, subtitlePathOf } from '@/browserDownloads/entries'
import type { DownloadServer } from '@/browserDownloads/server'
import type { DownloadStore } from '@/browserDownloads/store'

/** The most embedded subtitle tracks kept of one video: each is read from the whole file. */
const EMBEDDED_SUBTITLES_KEPT = 3

/** A text track the server turns into WebVTT; a picture track has no cues to keep. */
const isTextTrack = (track: SubtitleTrack): boolean => track.supported && !isPictureSubtitle(track)

/** Every sidecar, which comes whole, and the first few embedded tracks, which are read in windows. */
const tracksToKeep = (tracks: readonly SubtitleTrack[]): SubtitleTrack[] => {
  const text = tracks.filter(isTextTrack)
  return [
    ...text.filter(({ source }) => source === SUBTITLE_SOURCES.external),
    ...text
      .filter(({ source }) => source === SUBTITLE_SOURCES.embedded)
      .slice(0, EMBEDDED_SUBTITLES_KEPT),
  ]
}

type DownloadSubtitlesDeps = { disk: DownloadDisk; server: DownloadServer; store: DownloadStore }

type SaveProps = { downloadId: string; signal: AbortSignal }

export type ReadCuesProps = { downloadId: string; trackId: string }

export type DownloadSubtitles = {
  /**
   * The video's text subtitles as WebVTT beside it, since a browser draws none of an MP4 copy's
   * own. They are asked for once the file is whole, and a failure never fails the download.
   */
  save: (input: SaveProps) => Promise<void>
  /** One saved track's cues, read whole; none for a track that was not kept. */
  cues: (input: ReadCuesProps) => Promise<SubtitleCue[]>
}

type KeepTrackProps = {
  entry: BrowserEntry
  track: SubtitleTrack
  index: number
  signal: AbortSignal
}

export const createDownloadSubtitles = ({
  disk,
  server,
  store,
}: DownloadSubtitlesDeps): DownloadSubtitles => {
  /** One track's cues, whole: a sidecar in one answer, an embedded track a window at a time. */
  const cuesOf = async ({ entry, track, signal }: KeepTrackProps): Promise<SubtitleCue[]> => {
    const media = isMediaItem(entry.media) ? entry.media : null
    const last =
      track.source === SUBTITLE_SOURCES.external ? 0 : subtitleWindowOf(media?.duration ?? 0)
    const windows = Array.from({ length: last + 1 }, (_, window) => window)
    const read = await windows.reduce<Promise<SubtitleCue[]>>(async (previous, window) => {
      const cues = await previous
      signal.throwIfAborted()
      const more = await server.cues({ mediaId: entry.mediaId, trackId: track.id, window, signal })
      return [...cues, ...more]
    }, Promise.resolve([]))
    // Windows overlap, so a cue at a boundary arrives twice.
    return read.filter(
      (cue, index) =>
        read.findIndex(
          (other) => other.start === cue.start && other.end === cue.end && other.text === cue.text,
        ) === index,
    )
  }

  const keepTrack = async (props: KeepTrackProps): Promise<SavedSubtitle | null> => {
    try {
      const cues = await cuesOf(props)
      const name = `${props.index}.vtt`
      await disk.write({
        path: subtitlePathOf({ entry: props.entry, name }),
        data: formatWebVtt({ cues, timestampMap: null }),
      })
      return { track: props.track, name }
    } catch {
      // A track the server would not give is left out; the others and the video stand.
      return null
    }
  }

  return {
    save: async ({ downloadId, signal }) => {
      const entry = store.entryOf(downloadId)
      if (entry === null || entry.hasSubtitles) return
      const tracks = await server.api.getTracks(entry.mediaId)
      const kept = await tracksToKeep(tracks.subtitles).reduce<Promise<SavedSubtitle[]>>(
        async (previous, track, index) => {
          const saved = await previous
          if (signal.aborted) return saved
          const one = await keepTrack({ entry, track, index, signal })
          return one === null ? saved : [...saved, one]
        },
        Promise.resolve([]),
      )
      if (signal.aborted) return
      store.patch({ downloadId, patch: { tracks, subtitles: kept, hasSubtitles: true } })
    },
    cues: async ({ downloadId, trackId }) => {
      const entry = store.entryOf(downloadId)
      const saved = entry?.subtitles.find(({ track }) => track.id === trackId) ?? null
      if (entry === null || saved === null) return []
      const file = await disk.read(subtitlePathOf({ entry, name: saved.name }))
      return file === null ? [] : parseWebVtt(await file.text())
    },
  }
}
