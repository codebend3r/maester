import { DESKTOP_PATHS } from '@raven/core'
import type { ComponentType } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { BrowserDownloads } from '@/browserDownloads/engine'
import { browserPlayPathOf } from '@/browserDownloads/paths'
import { useDownloads } from '@/desktop/downloadsApi'
import { visibleDownloadsOf } from '@/desktop/DownloadsPage/libraries'
import { useDownloadsUnlocked } from '@/desktop/DownloadsPage/useDownloadsUnlocked'
import { offlineReturnOf } from '@/desktop/paths'
import { PlayerMessage } from '@/desktop/player/PlayerMessage'
import { useBrowserDownloads } from '@/stores/browserDownloads'

/** What a title's watch page does with no server: waits for the list, plays its download, or gives way. */
const OFFLINE_WATCHES = {
  waiting: 'waiting',
  downloaded: 'downloaded',
  missing: 'missing',
} as const

type OfflineWatchKind = (typeof OFFLINE_WATCHES)[keyof typeof OFFLINE_WATCHES]

type OfflineWatchViewProps = { downloadId: string | null; returnTo: string }

const Waiting = () => <PlayerMessage message={null} fallback={DESKTOP_PATHS.downloads} />

type ToDownloadProps = OfflineWatchViewProps

const ToDownload = ({ downloadId }: ToDownloadProps) =>
  downloadId !== null && <Navigate replace to={browserPlayPathOf(downloadId)} />

type ToDownloadsProps = OfflineWatchViewProps

/** Nothing of the title is here: to Downloads, which goes back to it once the server answers. */
const ToDownloads = ({ returnTo }: ToDownloadsProps) => (
  <Navigate replace to={DESKTOP_PATHS.downloads} state={offlineReturnOf(returnTo)} />
)

const OFFLINE_WATCH_VIEWS = {
  [OFFLINE_WATCHES.waiting]: Waiting,
  [OFFLINE_WATCHES.downloaded]: ToDownload,
  [OFFLINE_WATCHES.missing]: ToDownloads,
} as const satisfies Record<OfflineWatchKind, ComponentType<OfflineWatchViewProps>>

type KindOfProps = {
  engine: BrowserDownloads | null
  downloadId: string | null
  /** Whether the page has the list in hand, which it reads the title's download from. */
  isListed: boolean
}

const kindOf = ({ engine, downloadId, isListed }: KindOfProps): OfflineWatchKind => {
  if (downloadId !== null) return OFFLINE_WATCHES.downloaded
  return isListed && (engine?.isSettled() ?? false)
    ? OFFLINE_WATCHES.missing
    : OFFLINE_WATCHES.waiting
}

type OfflineWatchProps = {
  /** The title the address names; null for an address that names none. */
  mediaId: number | null
}

/**
 * A title's watch page while the server is out of reach, in a browser that keeps downloads: it
 * plays the title's download when there is a ready one the viewer may see, and otherwise goes
 * to Downloads, as any other page does then.
 */
export const OfflineWatch = ({ mediaId }: OfflineWatchProps) => {
  const engine = useBrowserDownloads((state) => state.engine)
  const { pathname, search } = useLocation()
  // Read so the page looks again when the list comes off the disk or the PIN's answer comes.
  const listed = useDownloads().data?.downloads ?? null
  const held = listed ?? []
  const isUnlocked = useDownloadsUnlocked(held)
  const visible = visibleDownloadsOf({ downloads: held, isUnlocked })
  const ready = mediaId === null ? null : (engine?.readyFor(mediaId) ?? null)
  const downloadId = visible.some((view) => view.downloadId === ready) ? ready : null
  const View = OFFLINE_WATCH_VIEWS[kindOf({ engine, downloadId, isListed: listed !== null })]
  return <View downloadId={downloadId} returnTo={`${pathname}${search}`} />
}
