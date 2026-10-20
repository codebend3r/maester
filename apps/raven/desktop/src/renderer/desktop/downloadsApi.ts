import {
  type QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useDesktop } from '@/renderer/stores/desktop'
import { RECENTS_KEY } from '@/renderer/Shell/openReply'
import { useNotice } from '@/renderer/stores/notice'
import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopRequest,
  DOWNLOAD_STATUS_KINDS,
  type DownloadView,
  type SpaceView,
} from '@/shared/protocol'

export const DOWNLOADS_KEY = ['desktop', 'downloads'] as const
const SPACE_KEY = ['desktop', 'space'] as const

const NO_DOWNLOADS = 'raven player could not read its downloads.'
const NO_SPACE = 'raven player could not read its disk space.'
/** Said when main does not answer a downloads request at all, or answers it with nonsense. */
export const UNREACHED = 'raven player could not reach its downloads. Try again.'

type DownloadsData = { downloads: DownloadView[]; autoDeleteDefault: boolean }

/** The downloads raven player keeps, and whether a new one starts out deleting once watched. */
export const useDownloads = (): UseQueryResult<DownloadsData> => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: DOWNLOADS_KEY,
    queryFn: async () => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.listDownloads })
      if (reply.type === DESKTOP_REPLIES.downloads) {
        return { downloads: reply.downloads, autoDeleteDefault: reply.autoDeleteDefault }
      }
      throw new Error(reply.type === DESKTOP_REPLIES.refused ? reply.message : NO_DOWNLOADS)
    },
    retry: false,
  })
}

type ListChange = { queryClient: QueryClient; event: DownloadsData }

const setDownloads = ({ queryClient, event }: ListChange) =>
  queryClient.setQueryData<DownloadsData>(DOWNLOADS_KEY, {
    downloads: event.downloads,
    autoDeleteDefault: event.autoDeleteDefault,
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
 * and Home's recents only when one left, as one deleted once watched leaves them too.
 */
export const applyDownloadsEvent = ({ queryClient, event }: ListChange) => {
  const before = queryClient.getQueryData<DownloadsData>(DOWNLOADS_KEY)?.downloads ?? []
  setDownloads({ queryClient, event })
  const move = { before, after: event.downloads }
  const isDropped = dropsAny(move)
  // Neither is awaited, and neither can reject: each list follows its own read.
  if (isDropped) void queryClient.invalidateQueries({ queryKey: RECENTS_KEY })
  if (isDropped || finishesAny(move)) void queryClient.invalidateQueries({ queryKey: SPACE_KEY })
}

/** The disk raven player keeps its downloads on. */
export const useSpace = (): UseQueryResult<SpaceView> => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: SPACE_KEY,
    queryFn: async () => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.readSpace })
      if (reply.type === DESKTOP_REPLIES.space) return reply.space
      throw new Error(reply.type === DESKTOP_REPLIES.refused ? reply.message : NO_SPACE)
    },
    retry: false,
  })
}

/** Queued or downloading: what Home's badge counts and what Pause all stops. */
export const isInProgress = (view: DownloadView): boolean =>
  view.status.kind === DOWNLOAD_STATUS_KINDS.queued ||
  view.status.kind === DOWNLOAD_STATUS_KINDS.downloading

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
 * again, so the space line follows a delete; a refusal, or no answer at all, is said as a notice.
 * Resolves true once main has made the change.
 */
export const useChangeDownloads = (): ((request: DownloadsChange) => Promise<boolean>) => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const showNotice = useNotice((state) => state.show)
  return async (request) => {
    const reply = await client.request(request).catch(() => null)
    if (reply === null) {
      showNotice(UNREACHED)
      return false
    }
    switch (reply.type) {
      case DESKTOP_REPLIES.downloads:
        setDownloads({ queryClient, event: reply })
        // Not awaited, and it cannot reject: the change is made, and the line follows the disk's read.
        void queryClient.invalidateQueries({ queryKey: SPACE_KEY })
        return true
      case DESKTOP_REPLIES.done:
        return true
      case DESKTOP_REPLIES.refused:
        showNotice(reply.message)
        return false
      case DESKTOP_REPLIES.play:
      case DESKTOP_REPLIES.playServer:
      case DESKTOP_REPLIES.file:
      case DESKTOP_REPLIES.recents:
      case DESKTOP_REPLIES.output:
      case DESKTOP_REPLIES.serverReply:
      case DESKTOP_REPLIES.serverUnreachable:
      case DESKTOP_REPLIES.servers:
      case DESKTOP_REPLIES.updates:
      case DESKTOP_REPLIES.downloadAsk:
      case DESKTOP_REPLIES.space:
      case DESKTOP_REPLIES.account:
        showNotice(UNREACHED)
        return false
      default: {
        const unreachable: never = reply
        return unreachable
      }
    }
  }
}
