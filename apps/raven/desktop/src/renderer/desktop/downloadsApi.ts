import { type QueryClient, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useDesktop } from '@/renderer/stores/desktop'
import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DownloadView,
  type SpaceView,
} from '@/shared/protocol'

export const DOWNLOADS_KEY = ['desktop', 'downloads'] as const
const SPACE_KEY = ['desktop', 'space'] as const

const NO_DOWNLOADS = 'raven player could not read its downloads.'
const NO_SPACE = 'raven player could not read its disk space.'

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
