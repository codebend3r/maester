import {
  type QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import { useNotice } from '@/renderer/Shell/openReply'
import type { DesktopRequest, DownloadView, SpaceView } from '@/shared/protocol'

export const DOWNLOADS_KEY = ['desktop', 'downloads'] as const
export const SPACE_KEY = ['desktop', 'space'] as const

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
      const reply = await client.request({ type: 'listDownloads' })
      if (reply.type === 'downloads') {
        return { downloads: reply.downloads, autoDeleteDefault: reply.autoDeleteDefault }
      }
      throw new Error(reply.type === 'refused' ? reply.message : NO_DOWNLOADS)
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

/** A file finished or left the list: what moves the disk's numbers, unlike progress. */
const movesDisk = ({ before, after }: { before: DownloadView[]; after: DownloadView[] }) => {
  const kept = new Set(after.map((view) => view.downloadId))
  const wasReady = new Set(
    before.filter((view) => view.status.kind === 'ready').map((view) => view.downloadId),
  )
  return (
    before.some((view) => !kept.has(view.downloadId)) ||
    after.some((view) => view.status.kind === 'ready' && !wasReady.has(view.downloadId))
  )
}

/**
 * What main pushes when a download changes: it replaces what the list holds. The disk is read
 * again only when a file finished or left, never for progress, which comes four times a second.
 */
export const applyDownloadsEvent = ({ queryClient, event }: ListChange) => {
  const before = queryClient.getQueryData<DownloadsData>(DOWNLOADS_KEY)?.downloads ?? []
  setDownloads({ queryClient, event })
  if (!movesDisk({ before, after: event.downloads })) return
  // Not awaited, and it cannot reject: the line follows the disk's read.
  void queryClient.invalidateQueries({ queryKey: SPACE_KEY })
}

/** The disk raven player keeps its downloads on. */
export const useSpace = (): UseQueryResult<SpaceView> => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: SPACE_KEY,
    queryFn: async () => {
      const reply = await client.request({ type: 'readSpace' })
      if (reply.type === 'space') return reply.space
      throw new Error(reply.type === 'refused' ? reply.message : NO_SPACE)
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
  const showNotice = useNotice()
  return async (request) => {
    const reply = await client.request(request).catch(() => null)
    if (reply === null) {
      showNotice(UNREACHED)
      return false
    }
    switch (reply.type) {
      case 'downloads':
        setDownloads({ queryClient, event: reply })
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
