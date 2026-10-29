import { beforeEach, describe, expect, it } from 'bun:test'
import { LIBRARY_VIEWS, MEDIA_GROUPINGS, MEDIA_SORTS } from '@raven/core'
import type { StateStorage } from 'zustand/middleware'

import {
  LIBRARY_VIEWS_KEY,
  configureLibraryViews,
  libraryChoiceOf,
  useLibraryViews,
} from '@/stores/libraryViews'

const SERVER = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER = '5d3c2b1a-0f9e-4d8c-b7a6-958473625140'

const memoryStorage = (entries: [string, string][] = []) => {
  const items = new Map(entries)
  const storage: StateStorage = {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value)
    },
    removeItem: (name) => {
      items.delete(name)
    },
  }
  return { storage, items }
}

describe('useLibraryViews', () => {
  beforeEach(() => useLibraryViews.setState({ choices: {} }))

  it("keeps each library's choice apart, per server, adding to what was chosen before", () => {
    const { choose } = useLibraryViews.getState()
    choose({ serverId: SERVER, libraryId: 1, change: { sort: MEDIA_SORTS.added } })
    choose({ serverId: SERVER, libraryId: 1, change: { view: LIBRARY_VIEWS.tiles } })
    choose({ serverId: OTHER, libraryId: 1, change: { sort: MEDIA_SORTS.largest } })

    const { choices } = useLibraryViews.getState()
    expect(libraryChoiceOf({ choices, serverId: SERVER, libraryId: 1 })).toEqual({
      sort: MEDIA_SORTS.added,
      view: LIBRARY_VIEWS.tiles,
    })
    expect(libraryChoiceOf({ choices, serverId: OTHER, libraryId: 1 })).toEqual({
      sort: MEDIA_SORTS.largest,
    })
    expect(libraryChoiceOf({ choices, serverId: SERVER, libraryId: 2 })).toEqual({})
  })

  it('reads back only the choices it can use', async () => {
    const saved = {
      state: {
        choices: {
          [`${SERVER}/1`]: { sort: MEDIA_SORTS.added, pinned: false },
          [`${SERVER}/2`]: { sort: 'loudest' },
          [`${SERVER}/3`]: { groupBy: MEDIA_GROUPINGS.codec },
          [`${SERVER}/4`]: LIBRARY_VIEWS.grid,
        },
      },
      version: 0,
    }
    const { storage } = memoryStorage([[LIBRARY_VIEWS_KEY, JSON.stringify(saved)]])
    await configureLibraryViews({ storage })

    expect(useLibraryViews.getState().choices).toEqual({
      [`${SERVER}/3`]: { groupBy: MEDIA_GROUPINGS.codec },
    })
  })

  it('starts empty from a file that is not its own', async () => {
    const { storage } = memoryStorage([[LIBRARY_VIEWS_KEY, '{"state":7}']])
    await configureLibraryViews({ storage })
    expect(useLibraryViews.getState().choices).toEqual({})
  })

  it('saves a choice to the storage it was given', async () => {
    const { storage, items } = memoryStorage()
    await configureLibraryViews({ storage })
    useLibraryViews
      .getState()
      .choose({ serverId: SERVER, libraryId: 1, change: { sort: MEDIA_SORTS.added } })

    const written: unknown = JSON.parse(items.get(LIBRARY_VIEWS_KEY) ?? 'null')
    expect(written).toEqual({
      state: { choices: { [`${SERVER}/1`]: { sort: MEDIA_SORTS.added } } },
      version: 0,
    })
  })

  it('keeps a picked view while the app is open, and neither saves nor reads one back', async () => {
    const { storage, items } = memoryStorage([
      [
        LIBRARY_VIEWS_KEY,
        JSON.stringify({
          state: { choices: { [`${SERVER}/2`]: { view: LIBRARY_VIEWS.list } } },
          version: 0,
        }),
      ],
    ])
    await configureLibraryViews({ storage })
    expect(useLibraryViews.getState().choices).toEqual({ [`${SERVER}/2`]: {} })

    useLibraryViews.getState().choose({
      serverId: SERVER,
      libraryId: 1,
      change: { sort: MEDIA_SORTS.added, view: LIBRARY_VIEWS.tiles },
    })
    expect(
      libraryChoiceOf({
        choices: useLibraryViews.getState().choices,
        serverId: SERVER,
        libraryId: 1,
      }),
    ).toEqual({ sort: MEDIA_SORTS.added, view: LIBRARY_VIEWS.tiles })
    const written: unknown = JSON.parse(items.get(LIBRARY_VIEWS_KEY) ?? 'null')
    expect(written).toEqual({
      state: { choices: { [`${SERVER}/2`]: {}, [`${SERVER}/1`]: { sort: MEDIA_SORTS.added } } },
      version: 0,
    })
  })
})
