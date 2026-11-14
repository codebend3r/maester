import { randomUUID } from 'node:crypto'
import { readdir, rename, stat, statfs, writeFile } from 'node:fs/promises'
import type { DesktopEvent } from '@raven/core'
import { app, shell } from 'electron'
import type { AccountSignal } from '@/main/accounts/accountSignal'
import type { AppStores } from '@/main/appStores'
import { syncRetryFrom } from '@/main/budgets'
import { createDownloadService, type DownloadService } from '@/main/downloads/downloadService'
import { createMediaAccess } from '@/main/downloads/mediaAccess'
import { SYNC_RETRY_MS } from '@/main/downloads/sync'
import type { Grants } from '@/main/grants'
import { fetchDownload } from '@/main/netFetches'
import { makeDir, openPart, removeTree, sizeOf } from '@/main/nodeFs'
import type { ServerPlumbing } from '@/main/servers/serverPlumbing'
import type { Timers } from '@/main/timers'

type OpenAppDownloadsProps = {
  stores: AppStores
  plumbing: ServerPlumbing
  grants: Grants
  accountIdOf: () => string | null
  accessEnds: AccountSignal
  accountSwitches: AccountSignal
  timers: Timers
  send: (event: DesktopEvent) => void
  warn: (message: string) => void
}

/**
 * The downloads over Node's file system and Electron's shell. Before the quit gate's own
 * `before-quit`, each running file's bytes on disk are saved while it is still downloading, then
 * every fetch is aborted, so the gate's first flush keeps them for the next launch; a run already
 * renaming its finished video still marks it ready, which the gate's second flush writes.
 */
export const openAppDownloads = ({
  stores,
  plumbing,
  grants,
  accountIdOf,
  accessEnds,
  accountSwitches,
  timers,
  send,
  warn,
}: OpenAppDownloadsProps): DownloadService => {
  const downloads = createDownloadService({
    store: stores.downloadsStore,
    config: stores.config,
    server: stores.server,
    calls: plumbing.calls,
    userData: stores.downloadsUserData,
    space: { mkdir: makeDir, statfs: (path) => statfs(path) },
    timers,
    now: Date.now,
    newId: randomUUID,
    send,
    warn,
    access: createMediaAccess({
      picks: plumbing.picks,
      now: Date.now,
      timers,
      tickets: plumbing.tickets,
    }),
    fetch: fetchDownload,
    writeBytes: ({ path, bytes }) => writeFile(path, bytes),
    fs: {
      mkdir: makeDir,
      rename: ({ from, to }) => rename(from, to),
      rm: removeTree,
      readdir: (path) => readdir(path),
      openPart,
      writeFile: ({ path, text }) => writeFile(path, text, 'utf8'),
      size: sizeOf,
    },
    showItemInFolder: (path) => shell.showItemInFolder(path),
    ready: app.whenReady(),
    wasSetAside: stores.wasSetAside,
    // A test hook shortens the five minutes; a packaged app never reads it.
    syncRetryMs: syncRetryFrom({ isPackaged: app.isPackaged, env: process.env }) ?? SYNC_RETRY_MS,
    grants,
    state: stores.store,
    stat: (path) => stat(path),
    accountIdOf,
  })
  app.once('before-quit', () => downloads.dispose())
  // A sign out: the downloads fetched with the account's ticket stop too.
  accessEnds.listen(() => downloads.accessEnded())
  // Another account signed in, or none: what the last one watched stays with it.
  accountSwitches.listen(() => downloads.accountSwitched())
  return downloads
}
