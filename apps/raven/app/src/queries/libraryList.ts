import { KINDS, type Library, libraryIconOf } from '@raven/core'

import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'
import { ROUTE_TARGETS } from '@/routes'

/** The one run of rows the Libraries screen lists. */
const LIBRARIES_SECTION = 'libraries'

/** A library as a row: its icon, its name and its type, opening it as the side menu's row does. */
const libraryCard = ({ id, name, settings }: Library): ShelfCard => ({
  key: `library:${id}`,
  title: name,
  line: KINDS[settings.kind].label,
  shape: CARD_SHAPES.poster,
  picture: null,
  progress: 0,
  icon: libraryIconOf(settings),
  target: { kind: ROUTE_TARGETS.library, libraryId: id, query: '' },
})

/** Every library the viewer may see, pinned or not, in the server's order; none for none. */
export const librarySectionsOf = (libraries: readonly Library[]): GridSection[] =>
  libraries.length === 0
    ? []
    : [
        {
          key: LIBRARIES_SECTION,
          title: null,
          count: null,
          shape: CARD_SHAPES.poster,
          cards: libraries.map(libraryCard),
        },
      ]
