import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, waitFor } from '@testing-library/react'
import { LIBRARY_WORK_KINDS, type Library, SCAN_KINDS, SCAN_STATES } from '@raven/core'
import { ravenQueriesFor } from '@/query/ravenQueries'
import { useServerActiveWork } from '@/query/useServerActiveWork'
import { library } from '@/test/fixtures'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

const { api } = recordingApi({ body: null })
const { librariesQuery } = ravenQueriesFor(api)

const spies = {
  read: spyOn(api, 'listLibraries'),
  cancelQuick: spyOn(api, 'cancelQuickScan'),
  cancelFull: spyOn(api, 'cancelScan'),
}

const SCANNING = { ...library().scan, state: SCAN_STATES.walking }

const setUp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderQueryHook({ client, hook: () => useServerActiveWork({ api, librariesQuery }) })
}

describe('useServerActiveWork', () => {
  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  it('lists the work running, cancels it all and reads the libraries again', async () => {
    let libraries: Library[] = [
      library({ id: 1, scan: SCANNING }),
      library({ id: 3, scan: { ...SCANNING, kind: SCAN_KINDS.quick } }),
      library({ id: 4 }),
    ]
    spies.read.mockImplementation(async () => libraries)
    spies.cancelFull.mockImplementation(async (id) => library({ id }))
    spies.cancelQuick.mockImplementation(async (id) => library({ id }))
    const { result } = setUp()
    await waitFor(() =>
      expect(result.current.running.map(({ library: { id }, kind }) => ({ id, kind }))).toEqual([
        { id: 1, kind: LIBRARY_WORK_KINDS.fullScan },
        { id: 3, kind: LIBRARY_WORK_KINDS.quickScan },
      ]),
    )
    libraries = libraries.map(({ id }) => library({ id }))
    act(() => result.current.cancel.mutate())
    await waitFor(() => expect(result.current.running).toEqual([]))
    expect(spies.cancelFull).toHaveBeenCalledWith(1)
    expect(spies.cancelQuick).toHaveBeenCalledWith(3)
    expect(result.current.error).toBeNull()
  })

  it('says why the libraries could not be read', async () => {
    spies.read.mockImplementation(async () => {
      throw new Error('offline')
    })
    const { result } = setUp()
    await waitFor(() => expect(result.current.error?.message).toBe('offline'))
    expect(result.current.running).toEqual([])
  })
})
