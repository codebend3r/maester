import type { ApiClient } from '@raven/core'
import { useMediaOrigin } from '@raven/ui'
import { browserCanPlay } from '@raven/ui/canPlay'
import { browserClock } from '@/browserDownloads/clock'
import { type DiskStorage, opfsDisk } from '@/browserDownloads/disk'
import { createBrowserDownloads } from '@/browserDownloads/engine'
import { browserDownloadsHost } from '@/browserDownloads/host'
import { mediaServerFor } from '@/browserDownloads/server'
import { canKeepDownloads, type DownloadsWindow } from '@/browserDownloads/support'
import { browserTabs, type TabsWindow } from '@/browserDownloads/tabs'
import { useBrowserDownloads } from '@/stores/browserDownloads'
import { useDownloadsHostStore } from '@/stores/downloadsHost'

type StartBrowserDownloadsProps = {
  target: DownloadsWindow &
    TabsWindow &
    Pick<Window, 'fetch'> & { navigator: { storage: DiskStorage } }
  api: ApiClient
  /** Inside Raven main keeps the downloads, so the browser's own never start. */
  isDesktop: boolean
}

/**
 * In a browser that can keep a video, makes its downloads and names them the page's downloads
 * host, before the first render, as `startDesktop` names Raven's; anywhere else it does nothing.
 * The index is read on its own time: until it is, the list is empty.
 */
export const startBrowserDownloads = ({
  target,
  api,
  isDesktop,
}: StartBrowserDownloadsProps): void => {
  if (isDesktop || !canKeepDownloads(target)) return
  const engine = createBrowserDownloads({
    disk: opfsDisk(target.navigator.storage),
    server: mediaServerFor({
      api,
      fetch: (url, init) => target.fetch(url, init),
      origin: () => useMediaOrigin.getState().pick?.origin ?? null,
      clock: browserClock,
    }),
    clock: browserClock,
    canPlay: browserCanPlay,
    urls: {
      create: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
    },
    newId: () => crypto.randomUUID(),
    tabs: browserTabs(target),
  })
  useBrowserDownloads.setState({ engine })
  useDownloadsHostStore.setState({ host: browserDownloadsHost(engine) })
  engine.start().catch(() => undefined)
}
