import { describe, expect, it } from 'bun:test'
import { pinnedIdsOn, pinnedLibrariesOn, pinnedShelvesOf, pinsToggled } from '@/libraryPins'

const HERE = '11111111-2222-4333-8444-555555555555'
const THERE = '66666666-7777-4888-9999-000000000000'
const AT = '2026-11-23T10:00:00.000Z'

const PINS = [
  { serverId: HERE, libraryId: 3, pinnedAt: AT },
  { serverId: THERE, libraryId: 1, pinnedAt: AT },
  { serverId: HERE, libraryId: 1, pinnedAt: AT },
]

describe('pinnedIdsOn', () => {
  it('lists the pins on one server only', () => {
    expect(pinnedIdsOn({ pins: PINS, serverId: HERE })).toEqual([3, 1])
  })

  it('lists none for a server with no id', () => {
    expect(pinnedIdsOn({ pins: PINS, serverId: null })).toEqual([])
  })
})

describe('pinnedLibrariesOn', () => {
  it("keeps the server's own order of its libraries", () => {
    const libraries = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(pinnedLibrariesOn({ libraries, pins: PINS, serverId: HERE })).toEqual([
      { id: 1 },
      { id: 3 },
    ])
  })
})

describe('pinnedShelvesOf', () => {
  const shelves = [{ libraryId: 1 }, { libraryId: 2 }]

  it("keeps the pinned libraries' shelves", () => {
    expect(pinnedShelvesOf({ shelves, pinnedHere: [2] })).toEqual([{ libraryId: 2 }])
  })

  it('keeps every shelf while none is pinned here', () => {
    expect(pinnedShelvesOf({ shelves, pinnedHere: [] })).toEqual(shelves)
  })
})

describe('pinsToggled', () => {
  it('adds a pin last', () => {
    expect(
      pinsToggled({ pins: PINS, serverId: THERE, libraryId: 2, shouldPin: true, pinnedAt: AT }),
    ).toEqual([...PINS, { serverId: THERE, libraryId: 2, pinnedAt: AT }])
  })

  it('takes a pin off by its server and library', () => {
    expect(
      pinsToggled({ pins: PINS, serverId: HERE, libraryId: 1, shouldPin: false, pinnedAt: AT }),
    ).toEqual(PINS.slice(0, 2))
  })
})
