import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopRequest,
  DOWNLOAD_STATUS_KINDS,
  type DownloadView,
  type SpaceView,
} from '@raven/core'
import { useToasts } from '@raven/ui'
import {
  type QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { refusalText } from '@/desktop/client'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { useDesktop } from '@/stores/desktop'

const NO_DOWNLOADS = 'raven player could not read its downloads.'
const NO_SPACE = 'raven player could not read its disk space.'
const UNCHANGED = 'raven player could not change its downloads. Try again.'

export type DownloadsData = { downloads: DownloadView[]; shouldAutoDelete: boolean }

/** The downloads raven player keeps, and whether a new one starts out deleting once watched. */
export const useDownloads = (): UseQueryResult<DownloadsData> => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: DESKTOP_QUERY_KEYS.downloads,
    queryFn: async () => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.listDownloads })
      if (reply.type === DESKTOP_REPLIES.downloads) {
        return { downloads: reply.downloads, shouldAutoDelete: reply.autoDeleteDefault }
      }
      throw new Error(refusalText({ reply, fallback: NO_DOWNLOADS }))
    },
    retry: false,
  })
}

type ListChange = {
  queryClient: QueryClient
  event: { downloads: DownloadView[]; autoDeleteDefault: boolean }
}

const setDownloads = ({ queryClient, event }: ListChange) =>
  queryClient.setQueryData<DownloadsData>(DESKTOP_QUERY_KEYS.downloads, {
    downloads: event.downloads,
    shouldAutoDelete: event.autoDeleteDefault,
  })

type ListMove = { before: DownloadView[]; after: DownloadView[] }

const dropsAny = ({ before, after }: ListMove): boolean => {
  const kept = new Set(after.map((view) => view.downloadId))
  return before.some((view) => !kept.has(view.downloadId))
}

const finishesAny = ({ before, after }: ListMove): boolean => {
  const wasReady = new Set(
    before
      .filter((view) => view.status.kind === DOWNLOAD_STATUS_KINDS.ready)
      .map((view) => view.downloadId),
  )
  return after.some(
    (view) => view.status.kind === DOWNLOAD_STATUS_KINDS.ready && !wasReady.has(view.downloadId),
  )
}

/**
 * What main pushes when a download changes: it replaces what the list holds. The disk is read
 * again only when a file finished or left, never for progress, which comes four times a second,
 * and the recents only when one left, as one deleted once watched leaves them too.
 */
export const applyDownloadsEvent = async ({ queryClient, event }: ListChange): Promise<void> => {
  const before =
    queryClient.getQueryData<DownloadsData>(DESKTOP_QUERY_KEYS.downloads)?.downloads ?? []
  setDownloads({ queryClient, event })
  const move = { before, after: event.downloads }
  const isDropped = dropsAny(move)
  await Promise.all([
    isDropped && queryClient.invalidateQueries({ queryKey: DESKTOP_QUERY_KEYS.recents }),
    (isDropped || finishesAny(move)) &&
      queryClient.invalidateQueries({ queryKey: DESKTOP_QUERY_KEYS.space }),
  ])
}

/** The disk raven player keeps its downloads on. */
export const useSpace = (): UseQueryResult<SpaceView> => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: DESKTOP_QUERY_KEYS.space,
    queryFn: async () => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.readSpace })
      if (reply.type === DESKTOP_REPLIES.space) return reply.space
      throw new Error(refusalText({ reply, fallback: NO_SPACE }))
    },
    retry: false,
  })
}

/** Queued or downloading: what the side menu's badge counts and what Pause all stops. */
export const isInProgress = (view: DownloadView): boolean =>
  view.status.kind === DOWNLOAD_STATUS_KINDS.queued ||
  view.status.kind === DOWNLOAD_STATUS_KINDS.downloading

/** How many downloads are queued or downloading; none until the list is read. */
export const useInProgressCount = (): number => {
  const downloads = useDownloads()
  return (downloads.data?.downloads ?? []).filter(isInProgress).length
}

/** What the Downloads page and Settings ask main to change. */
export type DownloadsChange = Extract<
  DesktopRequest,
  {
    type:
      | typeof DESKTOP_REQUESTS.pauseDownload
      | typeof DESKTOP_REQUESTS.resumeDownload
      | typeof DESKTOP_REQUESTS.retryDownload
      | typeof DESKTOP_REQUESTS.deleteDownload
      | typeof DESKTOP_REQUESTS.setDownloadAutoDelete
      | typeof DESKTOP_REQUESTS.pauseAllDownloads
      | typeof DESKTOP_REQUESTS.resumeAllDownloads
      | typeof DESKTOP_REQUESTS.deleteAllDownloads
      | typeof DESKTOP_REQUESTS.setDownloadDefaults
      | typeof DESKTOP_REQUESTS.showDownloadsFolder
  }
>

/**
 * Sends a change to main. The list main answers with replaces the query's, and the disk is read
 * again, so the space line follows a delete; a refusal is said as a toast. Resolves true once
 * main has made the change.
 */
export const useChangeDownloads = (): ((request: DownloadsChange) => Promise<boolean>) => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const showNotice = useToasts((state) => state.show)
  return async (request) => {
    const reply = await client.request(request)
    switch (reply.type) {
      case DESKTOP_REPLIES.downloads:
        setDownloads({ queryClient, event: reply })
        // The change is made; the space line follows the disk's read, which shows its own failure.
        queryClient.invalidateQueries({ queryKey: DESKTOP_QUERY_KEYS.space }).catch(() => undefined)
        return true
      case DESKTOP_REPLIES.done:
        return true
      case DESKTOP_REPLIES.refused:
        showNotice(reply.message)
        return false
      case DESKTOP_REPLIES.play:
      case DESKTOP_REPLIES.file:
      case DESKTOP_REPLIES.recents:
      case DESKTOP_REPLIES.output:
      case DESKTOP_REPLIES.navigate:
      case DESKTOP_REPLIES.title:
      case DESKTOP_REPLIES.titleRefused:
      case DESKTOP_REPLIES.updates:
      case DESKTOP_REPLIES.downloadAsk:
      case DESKTOP_REPLIES.space:
        showNotice(UNCHANGED)
        return false
      default: {
        const unreachable: never = reply
        return unreachable
      }
    }
  }
}
