import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, waitFor } from '@testing-library/react'
import { type Library, RATINGS_REFRESH_STATES, SCAN_KINDS, SCAN_STATES } from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import { useServerLibraryActions } from '@/query/useServerLibraryActions'
import { library } from '@/test/fixtures'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const { api } = recordingApi({ body: null })

const spies = {
  quickScan: spyOn(api, 'quickScanLibrary'),
  fullScan: spyOn(api, 'scanLibrary'),
  scanMarkers: spyOn(api, 'scanLibraryMarkers'),
  updateRatings: spyOn(api, 'updateLibraryRatings'),
  rematch: spyOn(api, 'matchLibrary'),
  mergeAlbums: spyOn(api, 'mergeLibraryAlbums'),
}

type SetUpProps = {
  shown?: Library
  onMarkersQueued?: () => void
  onAlbumsMerged?: (merged: number) => void
}

/** The hook for `shown`, library 2 by default, with the libraries list cached. */
const setUp = ({ shown = library(), onMarkersQueued, onAlbumsMerged }: SetUpProps = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.libraries, [shown])
  const { result } = renderQueryHook({
    client,
    hook: () => useServerLibraryActions({ api, library: shown, onMarkersQueued, onAlbumsMerged }),
  })
  const isStale = () => client.getQueryState(queryKeys.libraries)?.isInvalidated ?? false
  return { result, client, isStale }
}

const running = (kind: Library['scan']['kind']): Library =>
  library({ scan: { ...library().scan, state: SCAN_STATES.indexing, kind } })

describe('useServerLibraryActions', () => {
  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  it('runs nothing for an idle library', () => {
    const { result } = setUp()
    expect(result.current).toMatchObject({
      isScanRunning: false,
      isQuickScanning: false,
      isFullScanning: false,
      isUpdatingRatings: false,
    })
  })

  it('reads a running scan off the library, by its kind', () => {
    expect(setUp({ shown: running(SCAN_KINDS.quick) }).result.current).toMatchObject({
      isScanRunning: true,
      isQuickScanning: true,
      isFullScanning: false,
    })
    expect(setUp({ shown: running(SCAN_KINDS.full) }).result.current).toMatchObject({
      isQuickScanning: false,
      isFullScanning: true,
    })
    const refreshing = library({
      ratingsRefresh: {
        state: RATINGS_REFRESH_STATES.running,
        done: 0,
        total: 1,
        startedAt: '2026-11-01T00:00:00.000Z',
      },
    })
    expect(setUp({ shown: refreshing }).result.current.isUpdatingRatings).toBe(true)
  })

  it('shows a quick scan as running from the press, and caches the library it answers', async () => {
    const answer = Promise.withResolvers<Library>()
    spies.quickScan.mockImplementation(() => answer.promise)
    const { result, client, isStale } = setUp()
    act(() => result.current.quickScan.mutate())
    await waitFor(() => expect(result.current.isQuickScanning).toBe(true))
    const started = running(SCAN_KINDS.quick)
    answer.resolve(started)
    await waitFor(() => expect(client.getQueryData<Library>(queryKeys.library(2))).toEqual(started))
    expect(isStale()).toBe(true)
  })

  it('shows a full scan and a ratings update as running from the press', async () => {
    spies.fullScan.mockImplementation(() => new Promise(() => undefined))
    spies.updateRatings.mockImplementation(() => new Promise(() => undefined))
    const { result } = setUp()
    act(() => {
      result.current.fullScan.mutate()
      result.current.updateRatings.mutate()
    })
    await waitFor(() =>
      expect(result.current).toMatchObject({ isFullScanning: true, isUpdatingRatings: true }),
    )
  })

  it('tells the host once markers are queued, and how many albums a merge joined', async () => {
    spies.scanMarkers.mockImplementation(async () => library())
    spies.mergeAlbums.mockImplementation(async () => ({ merged: 3 }))
    const onMarkersQueued = mock(() => undefined)
    const onAlbumsMerged = mock((merged: number) => merged)
    const { result } = setUp({ onMarkersQueued, onAlbumsMerged })
    act(() => {
      result.current.scanMarkers.mutate()
      result.current.mergeAlbums.mutate()
    })
    await waitFor(() => expect(onAlbumsMerged).toHaveBeenCalledWith(3))
    expect(onMarkersQueued).toHaveBeenCalledTimes(1)
  })

  it('needs no host callbacks', async () => {
    spies.scanMarkers.mockImplementation(async () => library())
    spies.mergeAlbums.mockImplementation(async () => ({ merged: 0 }))
    const { result } = setUp()
    act(() => {
      result.current.scanMarkers.mutate()
      result.current.mergeAlbums.mutate()
    })
    await waitFor(() => expect(result.current.mergeAlbums.data).toEqual({ merged: 0 }))
    expect(result.current.scanMarkers.isSuccess).toBe(true)
  })

  it('caches the library Match again answers and reads its listings again', async () => {
    const matched = library({ unmatchedCount: 0 })
    spies.rematch.mockImplementation(async () => matched)
    const { result, client, isStale } = setUp({ shown: library({ unmatchedCount: 4 }) })
    act(() => result.current.rematch.mutate())
    await waitFor(() => expect(client.getQueryData<Library>(queryKeys.library(2))).toEqual(matched))
    expect(isStale()).toBe(true)
  })
})
