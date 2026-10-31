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
import { type MediaSources, type SourceOutcome } from '@raven/native/headless'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

import { useWrenPrefs } from '@/stores/wrenPrefs'

/** The key the downloads are stored under in AsyncStorage. */
export const DOWNLOADS_KEY = 'wren.downloads'

/** The folder under the app's documents every download lives in. */
export const DOWNLOADS_FOLDER = 'downloads'

/** The one file a downloaded track is: the server's AAC transcode, in an `.m4a`. */
const MEDIA_FILE = 'media.m4a'

/** Its album's cover, beside it, for the Downloads list, the lock screen and the car offline. */
const COVER_FILE = 'cover.jpg'

const PATH_SEPARATOR = '/'

const KEY_SEPARATOR = ':'

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
  /** The album cover's path beside it; null when the album has none or it could not be fetched. */
  coverPath: nullable(isString),
  track: isTrack,
  /** The album's summary when it was downloaded from its page; null for a playlist's track. */
  album: nullable(isAlbumSummary),
  status: oneOf(Object.values(DOWNLOAD_STATUSES)),
  /** Which time this track was queued: a fetch lands only on the entry it was started for. */
  queueStamp: isNumber,
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
  /** Whether a file is at `path`. */
  exists: (path: string) => boolean
  /** Every track's folder on disk, `downloads/<serverId>/<mediaId>`. */
  folders: () => string[]
  /** Deletes a track's folder and all in it. */
  remove: (folder: string) => Promise<void>
  /** Deletes every download. */
  removeAll: () => Promise<void>
}

/** Where a server's tracks download from; null for a server this device no longer holds. */
type SourcesOf = (serverId: string) => Pick<MediaSources, 'trackSource'> | null

type CoverOfProps = { serverId: string; track: Track }

/** Where a track's album cover is fetched from, with its headers; null when it has none. */
type CoverOf = (props: CoverOfProps) => Promise<TrackSource | null>

type DownloadDevice = {
  disk: DownloadDisk
  sourcesOf: SourcesOf
  coverOf: CoverOf
}

export type DownloadCollection =
  | { kind: typeof DOWNLOAD_SOURCES.album; album: AlbumSummary }
  | { kind: typeof DOWNLOAD_SOURCES.playlist; playlist: PlaylistSummary }

type DownloadTracksProps = {
  serverId: string
  tracks: readonly Track[]
  collection: DownloadCollection
}

type RemoveProps = { serverId: string; collection: DownloadCollection }

type KeepForProps = { accountId: string | null }

export type DownloadsValues = {
  /** The account this device's downloads belong to, claimed as it signs in; null until one has. */
  ownerId: string | null
  /** Each track by `downloadKeyOf`, so one server's media id never stands for another's. */
  entries: Record<string, DownloadEntry>
  /** Each playlist by `downloadKeyOf` of its server and its id. */
  playlists: Record<string, DownloadedPlaylist>
}

type Downloads = DownloadsValues & {
  device: DownloadDevice
  /** How many tracks are being fetched now. */
  running: number
  /** How many tracks this run has queued, which stamps each with its own `queueStamp`. */
  queuedCount: number
  /** Queues the tracks not yet downloaded and fetches them; resolves the refusal's words, or null. */
  downloadTracks: (props: DownloadTracksProps) => Promise<string | null>
  /** Lets go of an album or a playlist: its tracks go, files too, unless another download holds them. */
  remove: (props: RemoveProps) => Promise<void>
  /** Removes every download, keeping their owner. */
  removeAll: () => Promise<void>
  /**
   * Claims the downloads for `accountId`, signed in, when they have no owner; removes them all
   * when it is not their owner, makes it the owner, and answers true; keeps them otherwise.
   */
  keepFor: (props: KeepForProps) => Promise<boolean>
}

type DownloadKeyOfProps = { serverId: string; id: number }

/** A download's key: its server and its id, `<serverId>:<id>`. */
export const downloadKeyOf = ({ serverId, id }: DownloadKeyOfProps): string =>
  [serverId, id].join(KEY_SEPARATOR)

const keyOfEntry = (entry: DownloadEntry): string =>
  downloadKeyOf({ serverId: entry.serverId, id: entry.mediaId })

type FolderOfProps = { serverId: string; mediaId: number }

const folderOf = ({ serverId, mediaId }: FolderOfProps): string =>
  [DOWNLOADS_FOLDER, serverId, String(mediaId)].join(PATH_SEPARATOR)

/** The folder a track's files sit in: its path without the file's name. */
const folderOfPath = (path: string): string =>
  path.split(PATH_SEPARATOR).slice(0, -1).join(PATH_SEPARATOR)

type InFolderProps = { folder: string; file: string }

const inFolder = ({ folder, file }: InFolderProps): string => [folder, file].join(PATH_SEPARATOR)

export const isDone = (entry: DownloadEntry): boolean => entry.status === DOWNLOAD_STATUSES.done

type IsUnderwayProps = DownloadEntry

export const isUnderway = ({ status }: IsUnderwayProps): boolean =>
  status === DOWNLOAD_STATUSES.queued || status === DOWNLOAD_STATUSES.downloading

/** The bytes the finished downloads take. */
export const usedBytesOf = (entries: DownloadsValues['entries']): number =>
  Object.values(entries)
    .filter(isDone)
    .reduce((sum, entry) => sum + entry.bytes, 0)

type EstimateOfProps = { tracks: readonly Track[]; kbps: AudioBitrate }

/** What the tracks will take once transcoded, from their length. */
const estimateOf = ({ tracks, kbps }: EstimateOfProps): number =>
  tracks.reduce((sum, track) => sum + (track.duration ?? 0) * kbps * BYTES_PER_KBPS_SECOND, 0)

/** What the downloads take once those on their way are done: the finished bytes, and an estimate of the rest. */
const committedBytesOf = (entries: DownloadsValues['entries']): number =>
  usedBytesOf(entries) +
  Object.values(entries)
    .filter(isUnderway)
    .reduce((sum, entry) => sum + estimateOf({ tracks: [entry.track], kbps: entry.kbps }), 0)

type UnheldOfProps = Pick<DownloadsValues, 'entries' | 'playlists'> & { keys: readonly string[] }

/**
 * The entries among `keys` no download holds any more: one is held by its album, once that was
 * downloaded, or by a downloaded playlist that lists it.
 */
const unheldOf = ({ entries, playlists, keys }: UnheldOfProps): string[] =>
  keys.filter((key) => {
    const entry = entries[key]
    if (entry === undefined || entry.album !== null) return false
    return !Object.values(playlists).some(
      (each) => each.serverId === entry.serverId && each.mediaIds.includes(entry.mediaId),
    )
  })

const IGNORED = (): void => undefined

/** Holds the place of the device until `configureDownloads`: every fetch fails, and nothing is on disk. */
const UNCONFIGURED_DEVICE: DownloadDevice = {
  disk: {
    fetch: async () => {
      throw new Error('Downloads are not configured.')
    },
    uriOf: (path) => path,
    exists: () => false,
    folders: () => [],
    remove: async () => undefined,
    removeAll: async () => undefined,
  },
  sourcesOf: () => null,
  coverOf: async () => null,
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
    ownerId: isString(kept.ownerId) ? kept.ownerId : null,
    entries: Object.fromEntries(
      entries
        .filter(isDownloadEntry)
        .map((entry) => [
          keyOfEntry(entry),
          { ...entry, status: isDone(entry) ? entry.status : DOWNLOAD_STATUSES.failed },
        ]),
    ),
    playlists: Object.fromEntries(
      playlists
        .filter(isDownloadedPlaylist)
        .map((each) => [downloadKeyOf({ serverId: each.serverId, id: each.playlist.id }), each]),
    ),
  }
}

/**
 * Wren's downloads: each track the server's AAC transcode at "Download quality", under
 * `downloads/<serverId>/<mediaId>/media.m4a` with its album's cover beside it, with its `Track`
 * and its album's summary so the Downloads list plays with no server. Two download at once. A
 * download that would take the downloads, those on their way included, past "Storage limit" is
 * refused. The downloads belong to the account that signed in on this device (`ownerId`):
 * another account signing in removes them (`keepFor`). An album or a playlist holds its tracks,
 * and a track two of them share goes only once neither holds it. Persisted to AsyncStorage and guarded when read.
 */
export const useDownloads = create<Downloads>()(
  persist(
    (set, get) => {
      type PutProps = { entry: DownloadEntry }

      const put = ({ entry }: PutProps) =>
        set((state) => ({ entries: { ...state.entries, [keyOfEntry(entry)]: entry } }))

      /** The cover's path once fetched beside the track, or null; a cover that fails costs the track nothing. */
      const fetchCover = async (entry: DownloadEntry): Promise<string | null> => {
        const { disk, coverOf } = get().device
        const source = await coverOf({ serverId: entry.serverId, track: entry.track }).catch(
          () => null,
        )
        if (source === null) return null
        const path = inFolder({ folder: folderOfPath(entry.path), file: COVER_FILE })
        return disk.fetch({ source, path }).then(
          () => path,
          () => null,
        )
      }

      /** What a fetch learns of its track: whether it is whole, and its bytes and cover. */
      type Fetched = Pick<DownloadEntry, 'bytes' | 'coverPath' | 'status'>

      const fetchOne = async (entry: DownloadEntry): Promise<Fetched> => {
        const { disk, sourcesOf } = get().device
        try {
          const sources = sourcesOf(entry.serverId)
          if (sources === null) throw new Error(DOWNLOAD_COPY.unreachable)
          const outcome = await sources.trackSource({ mediaId: entry.mediaId, kbps: entry.kbps })
          if (!outcome.ok) throw new Error(outcome.message)
          const bytes = await disk.fetch({ source: outcome.source, path: entry.path })
          const coverPath = await fetchCover(entry)
          return { bytes, coverPath, status: DOWNLOAD_STATUSES.done }
        } catch {
          return { bytes: 0, coverPath: null, status: DOWNLOAD_STATUSES.failed }
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
        const now = get().entries[keyOfEntry(next)]
        const isCurrent = now !== undefined && now.queueStamp === next.queueStamp
        // Removed while it downloaded, what it wrote goes too, and a failure leaves no file.
        // Removed and queued again, the folder is the newer fetch's, and this one, done or
        // failed, lands nowhere.
        if (now === undefined || (isCurrent && fetched.status === DOWNLOAD_STATUSES.failed)) {
          await get().device.disk.remove(folderOfPath(next.path)).catch(IGNORED)
        }
        if (isCurrent) put({ entry: { ...now, ...fetched } })
        return runQueue()
      }

      type DropUnheldProps = { keys: readonly string[] }

      /** Deletes the entries among `keys` no download holds any more, and their folders. */
      const dropUnheld = async ({ keys }: DropUnheldProps): Promise<void> => {
        const { entries, playlists, device } = get()
        const gone = new Set(unheldOf({ entries, playlists, keys }))
        if (gone.size === 0) return
        const folders = [...gone].flatMap((key) => {
          const entry = entries[key]
          return entry === undefined ? [] : [folderOfPath(entry.path)]
        })
        set((state) => ({
          entries: Object.fromEntries(
            Object.entries(state.entries).filter(([key]) => !gone.has(key)),
          ),
        }))
        await Promise.allSettled(folders.map((folder) => device.disk.remove(folder)))
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
        ownerId: null,
        entries: {},
        playlists: {},
        device: UNCONFIGURED_DEVICE,
        running: 0,
        queuedCount: 0,
        downloadTracks: async ({ serverId, tracks, collection }) => {
          const { downloadKbps, storageLimitGb } = useWrenPrefs.getState()
          const { entries } = get()
          const kept = (track: Track): DownloadEntry | undefined =>
            entries[downloadKeyOf({ serverId, id: track.id })]
          const wanted = tracks.filter((track) => {
            const entry = kept(track)
            return entry === undefined || entry.status === DOWNLOAD_STATUSES.failed
          })
          const needed = estimateOf({ tracks: wanted, kbps: downloadKbps })
          if (
            storageLimitGb !== null &&
            committedBytesOf(entries) + needed > storageLimitGb * BYTES_PER_GB
          ) {
            return DOWNLOAD_COPY.full(storageLimitGb)
          }
          const album = collection.kind === DOWNLOAD_SOURCES.album ? collection.album : null
          const queueStamp = get().queuedCount + 1
          const saved =
            collection.kind === DOWNLOAD_SOURCES.playlist
              ? {
                  key: downloadKeyOf({ serverId, id: collection.playlist.id }),
                  playlist: {
                    serverId,
                    playlist: collection.playlist,
                    mediaIds: tracks.map(({ id }) => id),
                  },
                }
              : null
          // A playlist downloaded again lets go of the tracks that have left it since.
          const left = (saved === null ? [] : (get().playlists[saved.key]?.mediaIds ?? []))
            .filter((id) => !tracks.some((track) => track.id === id))
            .map((id) => downloadKeyOf({ serverId, id }))
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
              path: inFolder({
                folder: folderOf({ serverId, mediaId: track.id }),
                file: MEDIA_FILE,
              }),
              coverPath: null,
              track,
              album: entry?.album ?? album,
              status: DOWNLOAD_STATUSES.queued,
              queueStamp,
            }
          })
          set((state) => ({
            queuedCount: queueStamp,
            entries: {
              ...state.entries,
              ...Object.fromEntries(queued.map((entry) => [keyOfEntry(entry), entry])),
            },
            playlists:
              saved === null
                ? state.playlists
                : { ...state.playlists, [saved.key]: saved.playlist },
          }))
          await dropUnheld({ keys: left })
          const idle = Math.max(0, DOWNLOADS_AT_ONCE - get().running)
          await Promise.all(Array.from({ length: idle }, worker))
          return null
        },
        remove: async ({ serverId, collection }) => {
          const { entries, playlists } = get()
          switch (collection.kind) {
            case DOWNLOAD_SOURCES.album: {
              const released = Object.entries(entries).filter(
                ([, entry]) =>
                  entry.serverId === serverId && (entry.album?.id ?? null) === collection.album.id,
              )
              set((state) => ({
                entries: {
                  ...state.entries,
                  ...Object.fromEntries(
                    released.map(([key, entry]) => [key, { ...entry, album: null }]),
                  ),
                },
              }))
              return dropUnheld({ keys: released.map(([key]) => key) })
            }
            case DOWNLOAD_SOURCES.playlist: {
              const playlistKey = downloadKeyOf({ serverId, id: collection.playlist.id })
              const released = (playlists[playlistKey]?.mediaIds ?? []).map((id) =>
                downloadKeyOf({ serverId, id }),
              )
              set((state) => ({
                playlists: Object.fromEntries(
                  Object.entries(state.playlists).filter(([key]) => key !== playlistKey),
                ),
              }))
              return dropUnheld({ keys: released })
            }
            default: {
              const unknown: never = collection
              return unknown
            }
          }
        },
        removeAll: async () => {
          set({ entries: {}, playlists: {} })
          await get().device.disk.removeAll()
        },
        keepFor: async ({ accountId }) => {
          const { ownerId, removeAll } = get()
          if (accountId === null || ownerId === accountId) return false
          if (ownerId === null) {
            set({ ownerId: accountId })
            return false
          }
          await removeAll()
          set({ ownerId: accountId })
          return true
        },
      }
    },
    {
      name: DOWNLOADS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      partialize: ({ ownerId, entries, playlists }) => ({ ownerId, entries, playlists }),
      // Nothing saved yet keeps what is held: a download started before the read lands.
      merge: (saved, current) =>
        saved === undefined ? current : { ...current, ...downloadsOf(saved) },
    },
  ),
)

/**
 * Brings what was read back and what is on disk into line: a finished download whose file has
 * gone (the system cleared space, or the app was restored) is failed, to be fetched again, and
 * every folder no finished download holds, a stopped one's `.part` among them, is deleted.
 */
const reconcileDisk = async (): Promise<void> => {
  const { entries, device } = useDownloads.getState()
  const checked = Object.fromEntries(
    Object.entries(entries).map(([key, entry]): [string, DownloadEntry] => [
      key,
      isDone(entry) && !device.disk.exists(entry.path)
        ? { ...entry, bytes: 0, coverPath: null, status: DOWNLOAD_STATUSES.failed }
        : entry,
    ]),
  )
  useDownloads.setState({ entries: checked })
  const held = new Set(
    Object.values(checked)
      .filter(isDone)
      .map((entry) => folderOfPath(entry.path)),
  )
  const strays = device.disk.folders().filter((folder) => !held.has(folder))
  await Promise.allSettled(strays.map((folder) => device.disk.remove(folder)))
}

type ConfigureDownloadsProps = { storage: StateStorage } & DownloadDevice

/** Gives the downloads their storage, disk and servers, reads them back, and squares them with the disk. */
export const configureDownloads = async ({
  storage,
  disk,
  sourcesOf,
  coverOf,
}: ConfigureDownloadsProps) => {
  useDownloads.setState({ device: { disk, sourcesOf, coverOf } })
  useDownloads.persist.setOptions({ storage: createJSONStorage(() => storage) })
  await useDownloads.persist.rehydrate()
  await reconcileDisk()
}
