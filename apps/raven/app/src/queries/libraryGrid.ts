import {
  LIBRARY_VIEWS,
  type LibrarySettings,
  type MediaItem,
  type PosterEntry,
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
import { LIBRARY_GRID_COPY } from '@/queries/copy'
import { type ArtLogos, continueCard } from '@/queries/homeShelves'

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
const SECTION_KEYS = { all: 'all', shows: 'shows', continue: 'continue' } as const

type ContinueSectionsOfProps = Pictures & { entries: readonly PosterEntry[]; logos: ArtLogos }

/**
 * A library's Continue watching page: its videos with a saved spot, the most recently watched
 * first, as wide cards like Home's shelf, in one open run; none at all with nothing in progress.
 */
export const continueSectionsOf = ({
  entries,
  logos,
  ...pictures
}: ContinueSectionsOfProps): GridSection[] =>
  entries.length === 0
    ? []
    : [
        {
          key: SECTION_KEYS.continue,
          title: null,
          count: null,
          shape: CARD_SHAPES.wide,
          cards: entries.map((entry) => continueCard({ entry, logos, ...pictures })),
        },
      ]

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

const videos = (n: number): string => plural({ n, ...LIBRARY_GRID_COPY.videos })

type FileSectionsProps = FileCardsProps

/**
 * A library of files: one run, or the grouped view's buckets, as the web's `MediaGroups` cuts them.
 */
const fileSections = ({ files, ...cards }: FileSectionsProps): GridSection[] => {
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
  const isBucketed = files.length > 0
  const showRun: GridSection = {
    key: SECTION_KEYS.shows,
    title: isBucketed ? LIBRARY_GRID_COPY.matched : null,
    count: isBucketed ? plural({ n: shows.length, ...LIBRARY_GRID_COPY.shows }) : null,
    shape: CARD_SHAPES.poster,
    cards: shows.map((entry) => showCard({ entry, order, ...pictures })),
  }
  const shown: GridSection[] = shows.length === 0 ? [] : [showRun]
  const folders = unmatchedShowsOf(files).map((folder) => ({
    key: `folder:${folder.key}`,
    title: folder.title,
    count: LIBRARY_GRID_COPY.notMatched(
      plural({ n: folder.files.length, ...LIBRARY_GRID_COPY.episodes }),
    ),
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
