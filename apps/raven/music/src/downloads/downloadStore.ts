import {
  type AlbumSummary,
  type AudioBitrate,
  type Infer,
  type PlaylistSummary,
  type Track,
  isAlbumSummary,
  isAudioBitrate,
  isNumber,
  isPlaylistSummary,
  isRecord,
  isString,
  isTrack,
  listOf,
  nullable,
  object,
  oneOf,
} from '@raven/core'
import {
  BROWSE_KINDS,
  type BrowseTarget,
  type DownloadedLibrary,
  type MediaSources,
  type SourceOutcome,
} from '@raven/native/headless'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

import { useWrenPrefs } from '@/stores/wrenPrefs'

/** The key the downloads are stored under in AsyncStorage. */
export const DOWNLOADS_KEY = 'wren.downloads'

/** The folder under the app's documents every download lives in. */
export const DOWNLOADS_FOLDER = 'downloads'

/** The one file a downloaded track is: the server's AAC transcode, in an `.m4a`. */
const MEDIA_FILE = 'media.m4a'

export const DOWNLOAD_STATUSES = {
  queued: 'queued',
  downloading: 'downloading',
  done: 'done',
  failed: 'failed',
} as const

/** What a download was asked for from: an album's page, or a playlist's. */
export const DOWNLOAD_SOURCES = { album: 'album', playlist: 'playlist' } as const

/** How many tracks download at once: the server transcodes two at a time, and a request queued behind them past iOS's 60 s would time out. */
const DOWNLOADS_AT_ONCE = 2

const BYTES_PER_KBPS_SECOND = 125

const BYTES_PER_GB = 1_000_000_000

/** What Wren says when a download cannot start. */
export const DOWNLOAD_COPY = {
  full: (limitGb: number) =>
    `Downloads would pass the ${limitGb} GB limit. Remove some, or raise the limit in Settings.`,
  unreachable: 'The server this track is on is not signed in.',
} as const

const isDownloadEntry = object({
  mediaId: isNumber,
  serverId: isString,
  kbps: isAudioBitrate,
  bytes: isNumber,
  /** Under the app's documents, since the documents folder's own address moves on an update. */
  path: isString,
  track: isTrack,
  /** The album's summary when it was downloaded from its page; null for a playlist's track. */
  album: nullable(isAlbumSummary),
  status: oneOf(Object.values(DOWNLOAD_STATUSES)),
})

export type DownloadEntry = Infer<typeof isDownloadEntry>

const isDownloadedPlaylist = object({
  serverId: isString,
  playlist: isPlaylistSummary,
  mediaIds: listOf(isNumber),
})

/** A downloaded playlist: its summary, and its tracks in order, each a download of its own. */
type DownloadedPlaylist = Infer<typeof isDownloadedPlaylist>

/** What the player or a download fetches: the address and the headers it sends. */
type TrackSource = Extract<SourceOutcome, { ok: true }>['source']

type DiskFetchProps = { source: TrackSource; path: string }

/** Where the bytes go: `expo-file-system` on the device, memory in the tests. */
export type DownloadDisk = {
  /** Fetches `source` into a `.part` beside `path`, then moves it there; resolves its bytes. Leaves no file when it fails. */
  fetch: (props: DiskFetchProps) => Promise<number>
  /** The `file://` address `path` is at now. */
  uriOf: (path: string) => string
  /** Deletes a track's folder. */
  remove: (path: string) => Promise<void>
  /** Deletes every download. */
  removeAll: () => Promise<void>
}

/** Where a server's tracks download from; null for a server this device no longer holds. */
type SourcesOf = (serverId: string) => Pick<MediaSources, 'trackSource'> | null

type DownloadDevice = { disk: DownloadDisk; sourcesOf: SourcesOf }

export type DownloadCollection =
  | { kind: typeof DOWNLOAD_SOURCES.album; album: AlbumSummary }
  | { kind: typeof DOWNLOAD_SOURCES.playlist; playlist: PlaylistSummary }

type DownloadTracksProps = {
  serverId: string
  tracks: readonly Track[]
  collection: DownloadCollection
}

type RemoveProps = { mediaIds: readonly number[] }

type DownloadsValues = {
  entries: Record<number, DownloadEntry>
  playlists: Record<number, DownloadedPlaylist>
}

type Downloads = DownloadsValues & {
  device: DownloadDevice
  /** How many tracks are being fetched now. */
  running: number
  /** Queues the tracks not yet downloaded and fetches them; resolves the refusal's words, or null. */
  downloadTracks: (props: DownloadTracksProps) => Promise<string | null>
  remove: (props: RemoveProps) => Promise<void>
  removeAll: () => Promise<void>
}

type DownloadPathOfProps = { serverId: string; mediaId: number }

const downloadPathOf = ({ serverId, mediaId }: DownloadPathOfProps): string =>
  [DOWNLOADS_FOLDER, serverId, String(mediaId), MEDIA_FILE].join('/')

const isDone = (entry: DownloadEntry): boolean => entry.status === DOWNLOAD_STATUSES.done

/** The bytes the finished downloads take. */
export const usedBytesOf = (entries: DownloadsValues['entries']): number =>
  Object.values(entries)
    .filter(isDone)
    .reduce((sum, entry) => sum + entry.bytes, 0)

type EstimateOfProps = { tracks: readonly Track[]; kbps: AudioBitrate }

/** What the tracks will take once transcoded, from their length. */
const estimateOf = ({ tracks, kbps }: EstimateOfProps): number =>
  tracks.reduce((sum, track) => sum + (track.duration ?? 0) * kbps * BYTES_PER_KBPS_SECOND, 0)

const IGNORED = (): void => undefined

/** Holds the place of the device until `configureDownloads`: every fetch fails, and nothing is on disk. */
const UNCONFIGURED_DEVICE: DownloadDevice = {
  disk: {
    fetch: async () => {
      throw new Error('Downloads are not configured.')
    },
    uriOf: (path) => path,
    remove: async () => undefined,
    removeAll: async () => undefined,
  },
  sourcesOf: () => null,
}

const UNCONFIGURED_STORAGE: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

/**
 * What was read back, each entry kept only where it is one. A download the app was stopped in
 * the middle of failed with it, so it reads back failed, to be tried again.
 */
const downloadsOf = (saved: unknown): DownloadsValues => {
  const kept = isRecord(saved) ? saved : {}
  const entries = isRecord(kept.entries) ? Object.values(kept.entries) : []
  const playlists = isRecord(kept.playlists) ? Object.values(kept.playlists) : []
  return {
    entries: Object.fromEntries(
      entries
        .filter(isDownloadEntry)
        .map((entry) => [
          entry.mediaId,
          { ...entry, status: isDone(entry) ? entry.status : DOWNLOAD_STATUSES.failed },
        ]),
    ),
    playlists: Object.fromEntries(
      playlists.filter(isDownloadedPlaylist).map((each) => [each.playlist.id, each]),
    ),
  }
}

/**
 * Wren's downloads: each track the server's AAC transcode at "Download quality", under
 * `downloads/<serverId>/<mediaId>/media.m4a`, with its `Track` and its album's summary so the
 * Downloads list plays with no server. Two download at once. Past "Storage limit" a download is
 * refused. Persisted to AsyncStorage and guarded when read.
 */
export const useDownloads = create<Downloads>()(
  persist(
    (set, get) => {
      type PutProps = { entry: DownloadEntry }

      const put = ({ entry }: PutProps) =>
        set((state) => ({ entries: { ...state.entries, [entry.mediaId]: entry } }))

      const fetchOne = async (entry: DownloadEntry): Promise<DownloadEntry> => {
        const { disk, sourcesOf } = get().device
        try {
          const sources = sourcesOf(entry.serverId)
          if (sources === null) throw new Error(DOWNLOAD_COPY.unreachable)
          const outcome = await sources.trackSource({ mediaId: entry.mediaId, kbps: entry.kbps })
          if (!outcome.ok) throw new Error(outcome.message)
          const bytes = await disk.fetch({ source: outcome.source, path: entry.path })
          return { ...entry, bytes, status: DOWNLOAD_STATUSES.done }
        } catch {
          await disk.remove(entry.path).catch(IGNORED)
          return { ...entry, bytes: 0, status: DOWNLOAD_STATUSES.failed }
        }
      }

      /** Fetches the queued tracks one after another, until none is left. */
      const runQueue = async (): Promise<void> => {
        const next = Object.values(get().entries).find(
          ({ status }) => status === DOWNLOAD_STATUSES.queued,
        )
        if (next === undefined) return
        put({ entry: { ...next, status: DOWNLOAD_STATUSES.downloading } })
        const fetched = await fetchOne(next)
        const isRemoved = get().entries[next.mediaId] === undefined
        // Removed while it downloaded: what it wrote goes too.
        if (isRemoved) await get().device.disk.remove(next.path).catch(IGNORED)
        if (!isRemoved) put({ entry: fetched })
        return runQueue()
      }

      const worker = async (): Promise<void> => {
        set((state) => ({ running: state.running + 1 }))
        try {
          await runQueue()
        } finally {
          set((state) => ({ running: state.running - 1 }))
        }
      }

      return {
        entries: {},
        playlists: {},
        device: UNCONFIGURED_DEVICE,
        running: 0,
        downloadTracks: async ({ serverId, tracks, collection }) => {
          const { downloadKbps, storageLimitGb } = useWrenPrefs.getState()
          const { entries } = get()
          const kept = (track: Track) => entries[track.id]
          const wanted = tracks.filter((track) => {
            const entry = kept(track)
            return entry === undefined || entry.status === DOWNLOAD_STATUSES.failed
          })
          const needed = estimateOf({ tracks: wanted, kbps: downloadKbps })
          if (
            storageLimitGb !== null &&
            usedBytesOf(entries) + needed > storageLimitGb * BYTES_PER_GB
          ) {
            return DOWNLOAD_COPY.full(storageLimitGb)
          }
          const album = collection.kind === DOWNLOAD_SOURCES.album ? collection.album : null
          const queued = tracks.map((track): DownloadEntry => {
            const entry = kept(track)
            if (entry !== undefined && entry.status !== DOWNLOAD_STATUSES.failed) {
              return { ...entry, album: entry.album ?? album }
            }
            return {
              mediaId: track.id,
              serverId,
              kbps: downloadKbps,
              bytes: 0,
              path: downloadPathOf({ serverId, mediaId: track.id }),
              track,
              album: entry?.album ?? album,
              status: DOWNLOAD_STATUSES.queued,
            }
          })
          set((state) => ({
            entries: {
              ...state.entries,
              ...Object.fromEntries(queued.map((entry) => [entry.mediaId, entry])),
            },
            playlists:
              collection.kind === DOWNLOAD_SOURCES.playlist
                ? {
                    ...state.playlists,
                    [collection.playlist.id]: {
                      serverId,
                      playlist: collection.playlist,
                      mediaIds: tracks.map(({ id }) => id),
                    },
                  }
                : state.playlists,
          }))
          const idle = Math.max(0, DOWNLOADS_AT_ONCE - get().running)
          await Promise.all(Array.from({ length: idle }, worker))
          return null
        },
        remove: async ({ mediaIds }) => {
          const { entries, device } = get()
          const gone = new Set(mediaIds)
          const paths = mediaIds.flatMap((id) => {
            const entry = entries[id]
            return entry === undefined ? [] : [entry.path]
          })
          set((state) => ({
            entries: Object.fromEntries(
              Object.values(state.entries)
                .filter(({ mediaId }) => !gone.has(mediaId))
                .map((entry) => [entry.mediaId, entry]),
            ),
            // A playlist goes once none of its tracks is downloaded.
            playlists: Object.fromEntries(
              Object.values(state.playlists)
                .map((each) => ({ ...each, mediaIds: each.mediaIds.filter((id) => !gone.has(id)) }))
                .filter(({ mediaIds: left }) => left.length > 0)
                .map((each) => [each.playlist.id, each]),
            ),
          }))
          await Promise.allSettled(paths.map((path) => device.disk.remove(path)))
        },
        removeAll: async () => {
          set({ entries: {}, playlists: {} })
          await get().device.disk.removeAll()
        },
      }
    },
    {
      name: DOWNLOADS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      partialize: ({ entries, playlists }) => ({ entries, playlists }),
      // Nothing saved yet keeps what is held: a download started before the read lands.
      merge: (saved, current) =>
        saved === undefined ? current : { ...current, ...downloadsOf(saved) },
    },
  ),
)

type ConfigureDownloadsProps = { storage: StateStorage } & DownloadDevice

/** Gives the downloads their storage, disk and servers, and reads them back. */
export const configureDownloads = async ({ storage, disk, sourcesOf }: ConfigureDownloadsProps) => {
  useDownloads.setState({ device: { disk, sourcesOf } })
  useDownloads.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await useDownloads.persist.rehydrate()
}

type DownloadedOfProps = Pick<DownloadsValues, 'entries'> & { serverId: string; mediaId: number }

/** The finished download of `mediaId` from `serverId`, or undefined. */
export const downloadedOf = ({
  entries,
  serverId,
  mediaId,
}: DownloadedOfProps): DownloadEntry | undefined => {
  const entry = entries[mediaId]
  return entry !== undefined && entry.serverId === serverId && isDone(entry) ? entry : undefined
}

const byDiscAndNumber = (a: Track, b: Track): number =>
  a.disc === b.disc ? (a.number ?? 0) - (b.number ?? 0) : a.disc - b.disc

/**
 * What is downloaded from `serverId`, as CarPlay, Android Auto and the Downloads list read it:
 * the albums by title, the playlists by name, and a target's finished tracks in order.
 */
type DownloadedLibraryOfProps = DownloadsValues & { serverId: string }

export const downloadedLibraryOf = ({
  entries,
  playlists,
  serverId,
}: DownloadedLibraryOfProps): DownloadedLibrary => {
  const done = Object.values(entries).filter(
    (entry) => entry.serverId === serverId && isDone(entry),
  )
  const tracksOf = (target: BrowseTarget): Track[] => {
    switch (target.kind) {
      case BROWSE_KINDS.album:
        return done
          .filter(({ album }) => album?.id === target.albumId)
          .map(({ track }) => track)
          .toSorted(byDiscAndNumber)
      case BROWSE_KINDS.playlist:
        return (playlists[target.playlistId]?.mediaIds ?? []).flatMap((mediaId) => {
          const entry = downloadedOf({ entries, serverId, mediaId })
          return entry === undefined ? [] : [entry.track]
        })
      case BROWSE_KINDS.track: {
        const entry = downloadedOf({ entries, serverId, mediaId: target.mediaId })
        return entry === undefined ? [] : [entry.track]
      }
      default: {
        const unknown: never = target
        return unknown
      }
    }
  }
  return {
    albums: () =>
      [
        ...new Map(
          done.flatMap(({ album }) => (album === null ? [] : [[album.id, album] as const])),
        ).values(),
      ].toSorted((a, b) => a.sortTitle.localeCompare(b.sortTitle)),
    playlists: () =>
      Object.values(playlists)
        .filter((each) => each.serverId === serverId)
        .filter(
          ({ playlist }) =>
            tracksOf({ kind: BROWSE_KINDS.playlist, playlistId: playlist.id }).length > 0,
        )
        .map(({ playlist }) => playlist)
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    tracksOf,
  }
}

/** How far an album's or a playlist's tracks have downloaded, as its button shows it. */
export const DOWNLOAD_PROGRESS = {
  none: 'none',
  downloading: 'downloading',
  done: 'done',
  failed: 'failed',
} as const

type DownloadProgress = {
  kind: (typeof DOWNLOAD_PROGRESS)[keyof typeof DOWNLOAD_PROGRESS]
  done: number
  total: number
}

type DownloadProgressOfProps = Pick<DownloadsValues, 'entries'> & {
  serverId: string
  mediaIds: readonly number[]
}

/** Whether the tracks are downloading, all done, failed in part, or not (or not all) downloaded. */
export const downloadProgressOf = ({
  entries,
  serverId,
  mediaIds,
}: DownloadProgressOfProps): DownloadProgress => {
  const held = mediaIds.flatMap((id) => {
    const entry = entries[id]
    return entry !== undefined && entry.serverId === serverId ? [entry] : []
  })
  const done = held.filter(isDone).length
  const total = mediaIds.length
  const isActive = held.some(
    ({ status }) => status === DOWNLOAD_STATUSES.queued || status === DOWNLOAD_STATUSES.downloading,
  )
  if (isActive) return { kind: DOWNLOAD_PROGRESS.downloading, done, total }
  if (held.some(({ status }) => status === DOWNLOAD_STATUSES.failed)) {
    return { kind: DOWNLOAD_PROGRESS.failed, done, total }
  }
  return {
    kind: total > 0 && done === total ? DOWNLOAD_PROGRESS.done : DOWNLOAD_PROGRESS.none,
    done,
    total,
  }
}
