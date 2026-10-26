import { describe, expect, it, spyOn } from 'bun:test'
import { DESKTOP_REPLIES, DESKTOP_REQUESTS, DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { applyDownloadsEvent, type DownloadsData, useChangeDownloads } from '@/desktop/downloadsApi'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { useToasts } from '@raven/ui'
import { asDesktop, DL_2, fakeClient, viewOf } from '@/test/desktop'

type InvalidatedByProps = {
  before: DownloadsData['downloads']
  after: DownloadsData['downloads']
}

const invalidatedBy = async ({ before, after }: InvalidatedByProps) => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(DESKTOP_QUERY_KEYS.downloads, {
    downloads: before,
    shouldAutoDelete: false,
  })
  const invalidate = spyOn(queryClient, 'invalidateQueries')
  await applyDownloadsEvent({
    queryClient,
    event: { downloads: after, shouldAutoDeleteByDefault: false },
  })
  expect(queryClient.getQueryData<DownloadsData>(DESKTOP_QUERY_KEYS.downloads)).toEqual({
    downloads: after,
    shouldAutoDelete: false,
  })
  return invalidate.mock.calls.map(([filters]) => filters?.queryKey)
}

describe('applyDownloadsEvent', () => {
  it('reads nothing again for progress', async () => {
    const before = [viewOf({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 1 } })]
    const after = [viewOf({ status: { kind: DOWNLOAD_STATUS_KINDS.downloading, bytes: 2 } })]
    expect(await invalidatedBy({ before, after })).toEqual([])
  })

  it('reads the disk again once a download finishes', async () => {
    const before = [viewOf()]
    const after = [viewOf({ status: { kind: DOWNLOAD_STATUS_KINDS.ready } })]
    expect(await invalidatedBy({ before, after })).toEqual([DESKTOP_QUERY_KEYS.space])
  })

  it('reads the recents and the disk again once one leaves', async () => {
    const before = [viewOf(), viewOf({ downloadId: DL_2 })]
    const after = [viewOf()]
    expect(await invalidatedBy({ before, after })).toEqual([
      DESKTOP_QUERY_KEYS.recents,
      DESKTOP_QUERY_KEYS.space,
    ])
  })
})

describe('useChangeDownloads', () => {
  it('says an answer it cannot use, and that the change was not made', async () => {
    asDesktop(fakeClient({ request: async () => ({ type: DESKTOP_REPLIES.recents, recents: [] }) }))
    type WrapperProps = { children: ReactNode }

    const wrapper = ({ children }: WrapperProps) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useChangeDownloads(), { wrapper })
    expect(await result.current({ type: DESKTOP_REQUESTS.pauseAllDownloads })).toBe(false)
    expect(useToasts.getState().toasts.map((toast) => toast.message)).toEqual([
      'Raven could not change its downloads. Try again.',
    ])
  })
})
