import {
  type QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useDesktop } from '@/renderer/stores/desktop'
import { useNotice } from '@/renderer/stores/notice'
import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopRequest,
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

/** What main pushes when a download changes: it replaces what the list holds. */
export const applyDownloadsEvent = ({
  queryClient,
  event,
}: {
  queryClient: QueryClient
  event: DownloadsData
}) =>
  queryClient.setQueryData<DownloadsData>(DOWNLOADS_KEY, {
    downloads: event.downloads,
    autoDeleteDefault: event.autoDeleteDefault,
  })

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
  view.status.kind === 'queued' || view.status.kind === 'downloading'

/** What the Downloads page and Settings ask main to change. */
export type DownloadsChange = Extract<
  DesktopRequest,
  {
    type:
      | 'pauseDownload'
      | 'resumeDownload'
      | 'retryDownload'
      | 'deleteDownload'
      | 'setDownloadAutoDelete'
      | 'pauseAllDownloads'
      | 'resumeAllDownloads'
      | 'deleteAllDownloads'
      | 'setDownloadDefaults'
      | 'showDownloadsFolder'
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
      case 'downloads':
        applyDownloadsEvent({ queryClient, event: reply })
        // Not awaited, and it cannot reject: the change is made, and the line follows the disk's read.
        void queryClient.invalidateQueries({ queryKey: SPACE_KEY })
        return true
      case 'done':
        return true
      case 'refused':
        showNotice(reply.message)
        return false
      case 'play':
      case 'playServer':
      case 'file':
      case 'recents':
      case 'output':
      case 'serverReply':
      case 'serverUnreachable':
      case 'servers':
      case 'updates':
      case 'downloadAsk':
      case 'space':
        showNotice(UNREACHED)
        return false
      default: {
        const unreachable: never = reply
        return unreachable
      }
    }
  }
}
