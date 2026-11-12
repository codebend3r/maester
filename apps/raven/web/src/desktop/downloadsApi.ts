import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
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
import type { DownloadsChange } from '@/downloads/host'
import { useDownloadsHost } from '@/stores/downloadsHost'
import { useDownloadSpeeds } from '@/stores/downloadSpeeds'

const NO_DOWNLOADS = 'Raven could not read its downloads.'
const NO_SPACE = 'Raven could not read its disk space.'
const UNCHANGED = 'Raven could not change its downloads. Try again.'

export type DownloadsData = { downloads: DownloadView[]; shouldAutoDelete: boolean }

/** The downloads the host keeps, and whether a new one starts out deleting once watched. */
export const useDownloads = (): UseQueryResult<DownloadsData> => {
  const host = useDownloadsHost()
  return useQuery({
    queryKey: DESKTOP_QUERY_KEYS.downloads,
    queryFn: async () => {
      const reply = await host.request({ type: DESKTOP_REQUESTS.listDownloads })
      if (reply.type === DESKTOP_REPLIES.downloads) {
        useDownloadSpeeds.getState().observe({ downloads: reply.downloads, now: Date.now() })
        return { downloads: reply.downloads, shouldAutoDelete: reply.shouldAutoDeleteByDefault }
      }
      throw new Error(refusalText({ reply, fallback: NO_DOWNLOADS }))
    },
    retry: false,
  })
}

type ListChange = {
  queryClient: QueryClient
  event: { downloads: DownloadView[]; shouldAutoDeleteByDefault: boolean }
}

const setDownloads = ({ queryClient, event }: ListChange) => {
  useDownloadSpeeds.getState().observe({ downloads: event.downloads, now: Date.now() })
  return queryClient.setQueryData<DownloadsData>(DESKTOP_QUERY_KEYS.downloads, {
    downloads: event.downloads,
    shouldAutoDelete: event.shouldAutoDeleteByDefault,
  })
}

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
 * What the host pushes when a download changes: it replaces what the list holds. The disk is read
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

/** The disk the host keeps its downloads on. */
export const useSpace = (): UseQueryResult<SpaceView> => {
  const host = useDownloadsHost()
  return useQuery({
    queryKey: DESKTOP_QUERY_KEYS.space,
    queryFn: async () => {
      const reply = await host.request({ type: DESKTOP_REQUESTS.readSpace })
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

/**
 * Sends a change to the host. The list it answers with replaces the query's, and the disk is read
 * again, so the space line follows a delete; a refusal is said as a toast. Resolves true once
 * the host has made the change.
 */
export const useChangeDownloads = (): ((request: DownloadsChange) => Promise<boolean>) => {
  const host = useDownloadsHost()
  const queryClient = useQueryClient()
  const showNotice = useToasts((state) => state.show)
  return async (request) => {
    const reply = await host.request(request)
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
