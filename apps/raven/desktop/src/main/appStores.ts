import { randomUUID } from 'node:crypto'
import { realpath, rename } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_FILE,
  type ConfigStore,
  type FixedServer,
  loadConfig,
  type ServerEntry,
} from '@/main/desktopConfig'
import { settleDownloads } from '@/main/downloads/adopt'
import { DOWNLOADS_FILE } from '@/main/downloads/downloadState'
import {
  DOWNLOADS_DEBOUNCE_MS,
  type DownloadsStore,
  loadDownloads,
} from '@/main/downloads/downloadStore'
import { exists, makeDir, TEXT_FS } from '@/main/nodeFs'
import { createJsonStore, createStateStore, loadState, type StateStore } from '@/main/stateStore'
import type { Timers } from '@/main/timers'

/** What the page hears when a store cannot be saved. */
const STORE_NOTICES = {
  state: 'Raven could not save your recent videos.',
  config: 'Raven could not save its settings.',
  downloads: 'Raven could not save its downloads.',
} as const

const STORE_ERRORS = {
  state: 'Raven could not save its state.',
  config: 'Raven could not save its settings.',
  downloads: 'Raven could not save its downloads.',
} as const satisfies Record<keyof typeof STORE_NOTICES, string>

type StoreName = keyof typeof STORE_NOTICES

const STATE_FILE = 'player-state.json'
const STATE_DEBOUNCE_MS = 2000

type SaveFailedProps = { text: string; notice: string; error: unknown }

type OpenAppStoresProps = {
  userData: string
  fixedServer: FixedServer
  timers: Timers
  /** A store could not be saved: logged with `text`, and the page hears `notice`. */
  onSaveFailed: (input: SaveFailedProps) => void
  warn: (message: string) => void
}

export type AppStores = {
  /** The player's state: recents, resume spots and the window. */
  store: StateStore
  config: ConfigStore
  downloadsStore: DownloadsStore
  /** The server Raven plays from, fixed for the run. */
  server: ServerEntry
  /** The real folder the downloads are named under, as grants hold real paths. */
  downloadsUserData: string
  /** `downloads.json` could not be read and was set aside. */
  wasSetAside: boolean
}

/**
 * Reads the three stores at once, then files every download under the one server, its folders
 * moved first and saved before the config that says which servers were adopted, so a launch cut
 * short does it all again. An upgraded config is written then, so the server keeps its id.
 */
export const openAppStores = async ({
  userData,
  fixedServer,
  timers,
  onSaveFailed,
  warn,
}: OpenAppStoresProps): Promise<AppStores> => {
  const stateFile = join(userData, STATE_FILE)
  const configFile = join(userData, CONFIG_FILE)
  const downloadsFile = join(userData, DOWNLOADS_FILE)
  const onErrorOf =
    (name: StoreName) =>
    (error: unknown): void =>
      onSaveFailed({ text: STORE_ERRORS[name], notice: STORE_NOTICES[name], error })
  const [state, loadedConfig, loadedDownloads, downloadsUserData] = await Promise.all([
    loadState({ fs: TEXT_FS, file: stateFile, now: Date.now }),
    loadConfig({
      fs: TEXT_FS,
      file: configFile,
      now: Date.now,
      server: fixedServer,
      newId: randomUUID,
    }),
    loadDownloads({ fs: TEXT_FS, file: downloadsFile, now: Date.now }),
    /*
     * Grants hold real paths, so the downloads are named from the real folder too: a profile
     * reached through a link (a temporary folder on macOS) would otherwise match none of them.
     */
    realpath(userData).catch(() => userData),
  ])
  const store = createStateStore({
    fs: TEXT_FS,
    file: stateFile,
    initial: state,
    timers,
    debounceMs: STATE_DEBOUNCE_MS,
    onError: onErrorOf('state'),
  })
  // Written on the next tick after a change.
  const config = createJsonStore({
    fs: TEXT_FS,
    file: configFile,
    initial: loadedConfig.config,
    timers,
    debounceMs: 0,
    onError: onErrorOf('config'),
    isInitialUnsaved: loadedConfig.isChanged,
  })
  const downloadsStore = createJsonStore({
    fs: TEXT_FS,
    file: downloadsFile,
    initial: loadedDownloads.state,
    timers,
    debounceMs: DOWNLOADS_DEBOUNCE_MS,
    onError: onErrorOf('downloads'),
  })
  const { server } = config.read()
  const settled = await settleDownloads({
    state: loadedDownloads.state,
    serverId: server.id,
    adopted: loadedConfig.adopted,
    userData: downloadsUserData,
    fs: { mkdir: makeDir, rename: ({ from, to }) => rename(from, to), exists },
    warn,
  })
  downloadsStore.update(() => settled)
  await downloadsStore.flush()
  await config.flush()
  return {
    store,
    config,
    downloadsStore,
    server,
    downloadsUserData,
    wasSetAside: loadedDownloads.wasSetAside,
  }
}
