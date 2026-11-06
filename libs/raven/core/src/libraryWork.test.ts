import { describe, expect, it } from 'bun:test'
import { type Library, RATINGS_REFRESH_STATES, SCAN_KINDS, SCAN_STATES } from '@/contract'
import { LIBRARY_WORK_KINDS, activeWorkOf } from '@/libraryWork'
import { library } from '@/test/fixtures'

type Cancelled = { call: string; id: number }

/** The three cancels, each answering the library it was asked about and noting the call. */
const cancelsFor = (libraries: readonly Library[]) => {
  const cancelled: Cancelled[] = []
  const answer = ({ call, id }: Cancelled) => {
    cancelled.push({ call, id })
    const found = libraries.find((each) => each.id === id)
    if (found === undefined) throw new Error(`no library ${id}`)
    return Promise.resolve(found)
  }
  const api = {
    cancelQuickScan: (id: number) => answer({ call: 'quick', id }),
    cancelScan: (id: number) => answer({ call: 'full', id }),
    cancelLibraryRatings: (id: number) => answer({ call: 'ratings', id }),
  }
  return { api, cancelled }
}

const SCANNING = { ...library().scan, state: SCAN_STATES.indexing }

const LIBRARIES = [
  library({ id: 1, name: 'Films', scan: SCANNING }),
  library({
    id: 2,
    name: 'Series',
    scan: { ...SCANNING, kind: SCAN_KINDS.quick },
    ratingsRefresh: {
      state: RATINGS_REFRESH_STATES.running,
      done: 0,
      total: 2,
      startedAt: '2026-11-01T00:00:00.000Z',
    },
  }),
  library({ id: 3, name: 'Idle' }),
]

describe('activeWorkOf', () => {
  it('lists each running scan by its kind and each ratings update, and nothing idle', () => {
    const { api } = cancelsFor(LIBRARIES)
    expect(
      activeWorkOf({ api, libraries: LIBRARIES }).map(({ library: { id }, kind }) => ({
        id,
        kind,
      })),
    ).toEqual([
      { id: 1, kind: LIBRARY_WORK_KINDS.fullScan },
      { id: 2, kind: LIBRARY_WORK_KINDS.quickScan },
      { id: 2, kind: LIBRARY_WORK_KINDS.ratings },
    ])
  })

  it('stops each with the call for its own kind', async () => {
    const { api, cancelled } = cancelsFor(LIBRARIES)
    await Promise.all(activeWorkOf({ api, libraries: LIBRARIES }).map((work) => work.cancel()))
    expect(cancelled).toEqual([
      { call: 'full', id: 1 },
      { call: 'quick', id: 2 },
      { call: 'ratings', id: 2 },
    ])
  })

  it('is empty when nothing runs', () => {
    const { api } = cancelsFor([])
    expect(activeWorkOf({ api, libraries: [library()] })).toEqual([])
  })
})
