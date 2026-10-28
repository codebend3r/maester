import {
  LIBRARY_VIEWS,
  type LibrarySettings,
  type MediaItem,
  type ShowEntry,
  groupMedia,
  listsShows,
  plural,
  unmatchedShowsOf,
} from '@raven/core'

import {
  CARD_SHAPES,
  type CardShape,
  type Pictures,
  type ShelfCard,
  frameCard,
  libraryVideoCard,
  showCard,
  videoShapeFor,
} from '@/queries/cards'

/**
 * What a library lists, whatever its type: a TV library's shows and the files no show was found
 * for, or its files.
 */
export type Listing = { shows: ShowEntry[]; files: MediaItem[] }

/**
 * One run of a library's grid. A section with a title is a bucket, folded until opened, as
 * the web's are; the one untitled section of a plain grid is always open.
 */
export type GridSection = {
  key: string
  title: string | null
  count: string | null
  shape: CardShape
  cards: ShelfCard[]
}

/**
 * The keys of the sections a listing always has the one of: a plain grid's, or a TV library's
 * shows.
 */
const SECTION_KEYS = { all: 'all', shows: 'shows' } as const

type Cards = Pictures & { settings: LibrarySettings; now: Date }

type FileCardsProps = Cards & { files: MediaItem[] }

/** A library's videos as its type draws them, each saying what it is sorted by. */
const fileCards = ({ settings, now, files, ...pictures }: FileCardsProps) => ({
  shape: videoShapeFor(settings.kind),
  cards: files.map((media) =>
    libraryVideoCard({
      kind: settings.kind,
      media,
      order: { sort: settings.sort, now },
      ...pictures,
    }),
  ),
})

const videos = (n: number): string => plural({ n, one: 'video', many: 'videos' })

/**
 * A library of files: one run, or the grouped view's buckets, as the web's `MediaGroups` cuts them.
 */
const fileSections = ({ files, ...cards }: FileCardsProps): GridSection[] => {
  if (cards.settings.view !== LIBRARY_VIEWS.grouped) {
    return [{ key: SECTION_KEYS.all, title: null, count: null, ...fileCards({ files, ...cards }) }]
  }
  return groupMedia({ items: files, by: cards.settings.groupBy }).map((group) => {
    const { shape, cards: grouped } = fileCards({ files: group.items, ...cards })
    return {
      key: `group:${group.key}`,
      title: group.label,
      count: videos(group.items.length),
      shape,
      cards: grouped,
    }
  })
}

type ShowSectionsProps = Cards & Listing

/**
 * A TV library: its shows, then each show folder whose files no show was found for, as the
 * web's Not matched bucket lists them. With nothing unmatched the shows are one open run;
 * otherwise they are a bucket of their own, Matched, as on the web.
 */
const showSections = ({
  shows,
  files,
  settings,
  now,
  ...pictures
}: ShowSectionsProps): GridSection[] => {
  const order = { sort: settings.sort, now }
  const shown: GridSection[] =
    shows.length === 0
      ? []
      : [
          {
            key: SECTION_KEYS.shows,
            title: files.length === 0 ? null : 'Matched',
            count:
              files.length === 0 ? null : plural({ n: shows.length, one: 'show', many: 'shows' }),
            shape: CARD_SHAPES.poster,
            cards: shows.map((entry) => showCard({ entry, order, ...pictures })),
          },
        ]
  const folders = unmatchedShowsOf(files).map((folder) => ({
    key: `folder:${folder.key}`,
    title: folder.title,
    count: `Not matched, ${plural({ n: folder.files.length, one: 'episode', many: 'episodes' })}`,
    shape: CARD_SHAPES.wide,
    cards: folder.files.map((media) => frameCard({ media, order, ...pictures })),
  }))
  return [...shown, ...folders]
}

type LibrarySectionsOfProps = Cards & { listing: Listing }

/**
 * A library's listing as its grid lays it out, by its settings, which are already coherent
 * with its type, so a TV library is never grouped.
 */
export const librarySectionsOf = ({ listing, ...cards }: LibrarySectionsOfProps): GridSection[] =>
  listsShows(cards.settings.kind)
    ? showSections({ ...listing, ...cards })
    : fileSections({ files: listing.files, ...cards })
