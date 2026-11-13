import {
  IGNORED,
  OWNER_DECISIONS,
  UNCONFIGURED_DISK,
  keepReconciled,
  loadPersisted,
  ownerDecisionOf,
  savedOwnerOf,
} from '@raven/native/headless'
import { UNCONFIGURED_STORAGE } from '@raven/ui/headless'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import {
  type AskedGroup,
  DOWNLOAD_STATES,
  DOWNLOAD_WAYS,
  type DownloadEntry,
  type DownloadGroup,
  type DownloadLibrary,
  type DownloadRequest,
  type DownloadStatus,
  type EntryUpdate,
  QUEUED,
  downloadKeyOf,
  entriesOf,
  entryOf,
  failedWith,
  folderOfEntry,
  groupKeyOfEntry,
  isFailed,
  isQueued,
  keyOfEntry,
  libraryOfEntry,
  mediaIdOfRequest,
  nextPlaceOf,
} from '@/downloads/downloadEntries'
import { type DownloadDevice, fetchOne } from '@/downloads/downloadRun'
import { prepareAhead } from '@/downloads/prepareAhead'
import { reconcileDisk } from '@/downloads/reconcileDisk'
import { useDownloadProgress } from '@/stores/downloadProgress'

/** The key the downloads are stored under in AsyncStorage. */
export const DOWNLOADS_KEY = 'raven.downloads'

export type DownloadProps = {
  serverId: string
  group: AskedGroup
  /** The library the page or card asked from, filed on the group; null when it did not know. */
  library: DownloadLibrary | null
  /** The group's poster or cover, saved beside each file; null for none. */
  artUri: string | null
  /** The show's or movie's title art, saved beside each file; null for none. */
  logoUri: string | null
  items: readonly DownloadRequest[]
}

type KeyProps = { key: string }

type GroupProps = { groupKey: string }

type MoveProps = {
  key: string
  /** The queued entry to go before; null for the end of the queue. */
  before: string | null
}

type LockRefresh = { libraryId: number; isLocked: boolean }

type RefreshLocksProps = { serverId: string; locks: readonly LockRefresh[] }

type KeepForProps = { accountId: string | null }

type DownloadsState = {
  /**
   * The account the downloads belong to, claimed as it signs in; null until one has. Downloads
   * kept before they had owners read back with none, and the first account to sign in claims them.
   */
  ownerId: string | null
  /** Each download by `downloadKeyOf`. */
  entries: Record<string, DownloadEntry>
  device: DownloadDevice
  /** Whether the queue is being fetched now, one file at a time, so the queue's order is the order they land in. */
  isRunning: boolean
  /** How many times anything was queued, which stamps each queuing with its own `stamp`. */
  stamps: number
  /** Whether the queued copies behind the one downloading are being asked for. */
  isPreparingAhead: boolean
  /** Aborts each running fetch, by its download's key. */
  controllers: ReadonlyMap<string, AbortController>
  /**
   * Queues what is not on the device or on its way already, and fetches it; resolves once the
   * fetches it started are done. One already downloaded stays in the group it came with.
   */
  download: (props: DownloadProps) => Promise<void>
  /** Starts fetching what is queued, as after a relaunch; resolves once the queue is empty. */
  resume: () => Promise<void>
  /** Stops a download on its way and lets go of it and its bytes. */
  cancel: (props: KeyProps) => Promise<void>
  /** Queues a failed download again. */
  retry: (props: KeyProps) => Promise<void>
  /** Deletes a download and its files. */
  remove: (props: KeyProps) => Promise<void>
  /** Deletes every download of a group, a show's season or an album. */
  removeGroup: (props: GroupProps) => Promise<void>
  removeAll: () => Promise<void>
  /**
   * Puts a queued entry before another queued one, or last. Does nothing for an entry that
   * is downloading or preparing, or to put one before it: the one running stays first.
   */
  move: (props: MoveProps) => void
  /** Writes each library's lock as the server now lists it onto the downloads filed under it. */
  refreshLocks: (props: RefreshLocksProps) => void
  /**
   * Claims the downloads for `accountId`, signed in, when they have no owner; removes them all
   * when it is not their owner, makes it the owner, and answers true; keeps them otherwise.
   */
  keepFor: (props: KeepForProps) => Promise<boolean>
}

const UNCONFIGURED_DEVICE: DownloadDevice = {
  disk: UNCONFIGURED_DISK,
  serverOf: () => null,
  now: Date.now,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

const DOWNLOADING: DownloadStatus = { state: DOWNLOAD_STATES.downloading }

const FIRST_PREPARING: DownloadStatus = { state: DOWNLOAD_STATES.preparing, progress: 0 }

const UNREACHABLE = failedWith(DOWNLOAD_COPY.unreachable)

/**
 * The device app's downloads: movies, episodes and other videos (their original file where the
 * player takes it as it is, else the server's MP4 copy, which it makes first and the download
 * waits for) and tracks (their file, or AAC where AVPlayer cannot decode it), under
 * `downloads/<serverId>/<mediaId>/` with the group's picture beside each, so Downloads plays and
 * shows them with no server. One comes in at a time (`downloadRun.ts`), in the queue's order,
 * while the server makes the next copies ahead (`prepareAhead.ts`). Persisted to AsyncStorage
 * and guarded when read; the bytes and speeds of those on their way live in
 * `useDownloadProgress`, never written.
 */
export const useDownloads = create<DownloadsState>()(
  persist(
    (set, get) => {
      /** The entry as it is now, if it is still the queuing `entry` was read from. */
      const currentOf = (entry: DownloadEntry): DownloadEntry | null => {
        const now = get().entries[keyOfEntry(entry)]
        return now !== undefined && now.stamp === entry.stamp ? now : null
      }

      /** Writes `change` onto the entry, unless it was let go of or queued again meanwhile. */
      const updateEntry = ({ entry, change }: EntryUpdate): void => {
        const now = currentOf(entry)
        if (now === null) return
        set((state) => ({
          entries: { ...state.entries, [keyOfEntry(now)]: { ...now, ...change } },
        }))
      }

      /** The queue in its order: what is waiting, first place first. */
      const queued = (): DownloadEntry[] =>
        Object.values(get().entries)
          .filter(isQueued)
          .toSorted((a, b) => a.place - b.place)

      type ControllerProps = { key: string; controller: AbortController | null }

      /** Holds the fetch's controller under its key, or lets go of it. */
      const setController = ({ key, controller }: ControllerProps): void => {
        set((state) => {
          const kept = [...state.controllers].filter(([each]) => each !== key)
          const held: readonly (readonly [string, AbortController])[] =
            controller === null ? kept : [...kept, [key, controller]]
          return { controllers: new Map(held) }
        })
      }

      /** Fetches the queued downloads one after another, first place first, until none is left. */
      const runQueue = async (): Promise<void> => {
        const [next] = queued()
        if (next === undefined) return
        const key = keyOfEntry(next)
        const { device } = get()
        const server = device.serverOf(next.serverId)
        const controller = new AbortController()
        setController({ key, controller })
        updateEntry({
          entry: next,
          change: { status: next.way === DOWNLOAD_WAYS.copy ? FIRST_PREPARING : DOWNLOADING },
        })
        const outcome =
          server === null
            ? UNREACHABLE
            : await fetchOne({
                entry: next,
                context: {
                  device,
                  server,
                  current: () => currentOf(next),
                  update: (change) => updateEntry({ entry: next, change }),
                  progress: useDownloadProgress.getState(),
                  signal: controller.signal,
                },
              })
        setController({ key, controller: null })
        const now = currentOf(next)
        /*
         * Let go of while it downloaded, what it wrote goes too, and a failure leaves nothing.
         * Let go of and queued again, the folder is the newer fetch's, and this one lands nowhere.
         */
        const isGone = get().entries[key] === undefined
        if (isGone || (now !== null && outcome.state === DOWNLOAD_STATES.failed)) {
          await device.disk.remove(folderOfEntry(next)).catch(IGNORED)
        }
        if (now !== null) {
          // A failure's folder went with its pictures.
          const pictures =
            outcome.state === DOWNLOAD_STATES.done ? {} : { artPath: null, logoPath: null }
          updateEntry({ entry: now, change: { ...pictures, status: outcome } })
        }
        return runQueue()
      }

      const worker = async (): Promise<void> => {
        set({ isRunning: true })
        try {
          await runQueue()
        } finally {
          set({ isRunning: false })
        }
      }

      /** Starts asking ahead unless it already runs; it ends on its own with the queue. */
      const startPreparingAhead = (): void => {
        if (get().isPreparingAhead) return
        set({ isPreparingAhead: true })
        const stop = () => set({ isPreparingAhead: false })
        prepareAhead({
          device: get().device,
          queued,
          current: currentOf,
          update: updateEntry,
        }).then(stop, stop)
      }

      const resume = async (): Promise<void> => {
        // Preparing ahead runs beside the fetch and is never waited on.
        startPreparingAhead()
        if (get().isRunning) return
        await worker()
      }

      type DropProps = { keys: readonly string[] }

      /** Deletes the downloads `keys` names, stopping any on its way, and their folders. */
      const drop = async ({ keys }: DropProps): Promise<void> => {
        const { entries, device, controllers } = get()
        const gone = keys.flatMap((key) => {
          const entry = entries[key]
          return entry === undefined ? [] : [entry]
        })
        set((state) => ({
          entries: Object.fromEntries(
            Object.entries(state.entries).filter(([key]) => !keys.includes(key)),
          ),
        }))
        keys.forEach((key) => controllers.get(key)?.abort())
        await Promise.allSettled(gone.map((entry) => device.disk.remove(folderOfEntry(entry))))
      }

      return {
        ownerId: null,
        entries: {},
        device: UNCONFIGURED_DEVICE,
        isRunning: false,
        stamps: 0,
        isPreparingAhead: false,
        controllers: new Map(),
        download: async ({ serverId, group, library, artUri, logoUri, items }) => {
          const stamp = get().stamps + 1
          const addedAt = get().device.now()
          const first = nextPlaceOf(Object.values(get().entries))
          const filed: DownloadGroup = { ...group, library }
          const isWanted = (item: DownloadRequest): boolean => {
            const kept = get().entries[downloadKeyOf({ serverId, mediaId: mediaIdOfRequest(item) })]
            return kept === undefined || isFailed(kept)
          }
          const fresh = items.filter(isWanted).map((item, index) =>
            entryOf({
              serverId,
              group: filed,
              artUri,
              logoUri,
              item,
              addedAt,
              stamp,
              place: first + index,
            }),
          )
          set((state) => ({
            stamps: stamp,
            entries: {
              ...state.entries,
              ...Object.fromEntries(fresh.map((entry) => [keyOfEntry(entry), entry])),
            },
          }))
          await resume()
        },
        resume,
        cancel: ({ key }) => drop({ keys: [key] }),
        retry: async ({ key }) => {
          const entry = get().entries[key]
          if (entry === undefined || !isFailed(entry)) return
          const stamp = get().stamps + 1
          const place = nextPlaceOf(Object.values(get().entries))
          set((state) => ({
            stamps: stamp,
            entries: { ...state.entries, [key]: { ...entry, status: QUEUED, stamp, place } },
          }))
          await resume()
        },
        move: ({ key, before }) => {
          const line = queued()
          const moving = line.find((entry) => keyOfEntry(entry) === key)
          if (moving === undefined) return
          if (before !== null && !line.some((entry) => keyOfEntry(entry) === before)) return
          const rest = line.filter((entry) => keyOfEntry(entry) !== key)
          const at =
            before === null ? rest.length : rest.findIndex((entry) => keyOfEntry(entry) === before)
          const reordered = [...rest.slice(0, at), moving, ...rest.slice(at)]
          const places = line.map((entry) => entry.place).toSorted((a, b) => a - b)
          set((state) => ({
            entries: {
              ...state.entries,
              ...Object.fromEntries(
                reordered.map((entry, index) => [
                  keyOfEntry(entry),
                  { ...entry, place: places[index] ?? entry.place },
                ]),
              ),
            },
          }))
        },
        refreshLocks: ({ serverId, locks }) => {
          const byLibrary = new Map(locks.map(({ libraryId, isLocked }) => [libraryId, isLocked]))
          const relocked = (entry: DownloadEntry): DownloadEntry => {
            const library = libraryOfEntry(entry)
            if (entry.serverId !== serverId || library === null) return entry
            const isLocked = byLibrary.get(library.id) ?? library.isLocked
            if (isLocked === library.isLocked) return entry
            return { ...entry, group: { ...entry.group, library: { ...library, isLocked } } }
          }
          set((state) => ({
            entries: Object.fromEntries(
              Object.entries(state.entries).map(([key, entry]) => [key, relocked(entry)]),
            ),
          }))
        },
        remove: ({ key }) => drop({ keys: [key] }),
        removeGroup: ({ groupKey }) =>
          drop({
            keys: Object.values(get().entries)
              .filter((entry) => groupKeyOfEntry(entry) === groupKey)
              .map(keyOfEntry),
          }),
        removeAll: async () => {
          get().controllers.forEach((controller) => controller.abort())
          set({ entries: {} })
          await get().device.disk.removeAll()
        },
        keepFor: async ({ accountId }) => {
          const decision = ownerDecisionOf({ ownerId: get().ownerId, accountId })
          if (decision === OWNER_DECISIONS.keep) return false
          if (decision === OWNER_DECISIONS.replace) await get().removeAll()
          set({ ownerId: accountId })
          return decision === OWNER_DECISIONS.replace
        },
      }
    },
    {
      name: DOWNLOADS_KEY,
      storage: createJSONStorage(() => UNCONFIGURED_STORAGE),
      skipHydration: true,
      partialize: ({ ownerId, entries }) => ({ ownerId, entries }),
      // Nothing saved yet keeps what is held: a download asked for before the read lands.
      merge: (saved, current) =>
        saved === undefined
          ? current
          : { ...current, ownerId: savedOwnerOf(saved), entries: entriesOf(saved) },
    },
  ),
)

type ConfigureDownloadsProps = { storage: StateStorage } & DownloadDevice

/**
 * Gives the downloads their storage, disk and servers, reads them back and squares them with
 * the disk; `resume` then starts again what a relaunch stopped.
 */
export const configureDownloads = async ({ storage, ...device }: ConfigureDownloadsProps) => {
  useDownloads.setState({ device })
  await loadPersisted({ store: useDownloads, storage })
  const read = useDownloads.getState().entries
  const checked = await reconcileDisk({ entries: read, disk: device.disk })
  useDownloads.setState((state) => ({
    entries: keepReconciled({ read, checked, now: state.entries }),
  }))
}
