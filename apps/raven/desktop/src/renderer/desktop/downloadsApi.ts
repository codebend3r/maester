import type { QueryClient } from '@tanstack/react-query'
import type { DownloadView } from '@/shared/protocol'

export const DOWNLOADS_KEY = ['desktop', 'downloads'] as const

type DownloadsData = { downloads: DownloadView[]; autoDeleteDefault: boolean }

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
