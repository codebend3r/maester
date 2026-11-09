import { describe, expect, it } from 'bun:test'

import { librarySectionsOf } from '@/queries/libraryList'
import { pinnedLibrariesOf } from '@/queries/pinnedLibraries'
import { FILMS, SERIES } from '@/test/homeServer'

const LOCKED_SERIES = { ...SERIES, settings: { ...SERIES.settings, locked: true } }

describe('locked libraries in the lists', () => {
  it('lists a locked library on the Libraries screen, its type marked locked', () => {
    const [section] = librarySectionsOf([FILMS, LOCKED_SERIES])
    expect(section?.cards.map((card) => card.line)).toEqual(['Movies', 'TV shows · Locked'])
  })

  it('lists a locked pinned library in the side menus, marked as locked', () => {
    expect(
      pinnedLibrariesOf([FILMS, LOCKED_SERIES]).map(({ name, isLocked }) => ({ name, isLocked })),
    ).toEqual([
      { name: FILMS.name, isLocked: false },
      { name: SERIES.name, isLocked: true },
    ])
  })
})
