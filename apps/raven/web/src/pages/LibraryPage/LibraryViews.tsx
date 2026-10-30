import {
  ITEM_TYPES,
  LIBRARY_VIEWS,
  type LibraryView,
  type LibrarySettings,
  type MediaItem,
  type ShowEntry,
  listsShows,
  matchTypeFor,
  plural,
  unmatchedShowsOf,
} from '@raven/core'
import { Bucket } from '@/components/Bucket/Bucket'
import { CoverGridSkeleton, MediaCovers, ShowCovers } from '@/components/CoverGrid/CoverGrid'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { MediaGroups } from '@/components/MediaGroups/MediaGroups'
import { MediaList } from '@/components/MediaList/MediaList'
import { MediaTiles, MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { ShowGrid, ShowGridSkeleton } from '@/components/ShowCard/ShowCard'
import { ShowList, ShowTiles } from '@/components/ShowCard/ShowViews'
import { Loading } from '@/components/Skeleton/Skeleton'
import { UnmatchedShows } from '@/components/UnmatchedShows/UnmatchedShows'
import type { ComponentType } from 'react'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type ShowsViewProps = { settings: LibrarySettings; shows: ShowEntry[] }

type ShowGridViewProps = ShowsViewProps

const ShowGridView = ({ settings, shows }: ShowGridViewProps) => (
  <ShowGrid shows={shows} ratingsSource={settings.ratingsSource} sort={settings.sort} />
)

/** A TV library's shows for each view setting; the grouped view is the grid, as the page itself splits matched from not. */
const SHOWS_VIEWS = {
  [LIBRARY_VIEWS.list]: ({ shows }: ShowsViewProps) => <ShowList shows={shows} />,
  [LIBRARY_VIEWS.covers]: ({ shows }: ShowsViewProps) => <ShowCovers shows={shows} />,
  [LIBRARY_VIEWS.tiles]: ({ settings, shows }: ShowsViewProps) => (
    <ShowTiles shows={shows} sort={settings.sort} />
  ),
  [LIBRARY_VIEWS.grid]: ShowGridView,
  [LIBRARY_VIEWS.grouped]: ShowGridView,
} as const satisfies Record<LibraryView, ComponentType<ShowsViewProps>>

/** A TV library's shows laid out the way its view setting says. */
const ShowsView = ({ settings, shows }: ShowsViewProps) => {
  const View = SHOWS_VIEWS[settings.view]
  return <View settings={settings} shows={shows} />
}

/** A Movies library lays its videos out as posters; any other, as frame grabs. */
const isMovieLibrary = (settings: LibrarySettings): boolean =>
  matchTypeFor(settings.kind) === ITEM_TYPES.movie

type MediaViewProps = { settings: LibrarySettings; items: MediaItem[] }

/** The library's videos for each view setting, a Movies library's as posters. */
const MEDIA_VIEWS = {
  [LIBRARY_VIEWS.list]: ({ settings, items }: MediaViewProps) => (
    <MediaList
      items={items}
      movies={isMovieLibrary(settings)}
      matchType={matchTypeFor(settings.kind)}
    />
  ),
  [LIBRARY_VIEWS.covers]: ({ settings, items }: MediaViewProps) => (
    <MediaCovers items={items} posters={isMovieLibrary(settings)} />
  ),
  [LIBRARY_VIEWS.tiles]: ({ settings, items }: MediaViewProps) => (
    <MediaTiles
      items={items}
      posters={isMovieLibrary(settings)}
      matchType={matchTypeFor(settings.kind)}
      sort={settings.sort}
    />
  ),
  [LIBRARY_VIEWS.grouped]: ({ settings, items }: MediaViewProps) => (
    <MediaGroups
      items={items}
      by={settings.groupBy}
      posters={isMovieLibrary(settings)}
      matchType={matchTypeFor(settings.kind)}
      ratingsSource={settings.ratingsSource}
      sort={settings.sort}
    />
  ),
  [LIBRARY_VIEWS.grid]: ({ settings, items }: MediaViewProps) => (
    <MediaGrid
      items={items}
      posters={isMovieLibrary(settings)}
      matchType={matchTypeFor(settings.kind)}
      ratingsSource={settings.ratingsSource}
      sort={settings.sort}
    />
  ),
} as const satisfies Record<LibraryView, ComponentType<MediaViewProps>>

/**
 * The library's videos laid out the way its view setting says, each card or
 * tile showing the value the listing is sorted by. The settings are coherent
 * with the library's type, so a TV library's leftover files are never grouped.
 */
const MediaView = ({ settings, items }: MediaViewProps) => {
  const View = MEDIA_VIEWS[settings.view]
  return <View settings={settings} items={items} />
}

type LibraryListingProps = {
  settings: LibrarySettings
  shows: ShowEntry[]
  files: MediaItem[]
}

const LISTING_LAYOUTS = { files: 'files', shows: 'shows', buckets: 'buckets' } as const

type ListingLayout = (typeof LISTING_LAYOUTS)[keyof typeof LISTING_LAYOUTS]

type ListingBucketsProps = LibraryListingProps

/** Matched shows, then the files no show was found for, each in a bucket. */
const ListingBuckets = ({ settings, shows, files }: ListingBucketsProps) => (
  <div className={styles.buckets}>
    {shows.length > 0 && (
      <Bucket
        label={LIBRARY_COPY.matched}
        count={plural({ n: shows.length, one: LIBRARY_COPY.show, many: LIBRARY_COPY.shows })}
      >
        <ShowsView settings={settings} shows={shows} />
      </Bucket>
    )}
    <Bucket
      label={COMMON_COPY.notMatched}
      count={plural({
        n: unmatchedShowsOf(files).length,
        one: LIBRARY_COPY.show,
        many: LIBRARY_COPY.shows,
      })}
    >
      <UnmatchedShows
        files={files}
        renderFiles={(group) => <MediaView settings={settings} items={group} />}
      />
    </Bucket>
  </div>
)

const LISTING_VIEWS = {
  [LISTING_LAYOUTS.files]: ({ settings, files }: LibraryListingProps) => (
    <MediaView settings={settings} items={files} />
  ),
  [LISTING_LAYOUTS.shows]: ({ settings, shows }: LibraryListingProps) => (
    <ShowsView settings={settings} shows={shows} />
  ),
  [LISTING_LAYOUTS.buckets]: ListingBuckets,
} as const satisfies Record<ListingLayout, ComponentType<LibraryListingProps>>

type ListingLayoutOfProps = { settings: LibrarySettings; files: MediaItem[] }

/** Files alone outside a TV library, its shows alone when every file is matched, else both. */
const listingLayoutOf = ({ settings, files }: ListingLayoutOfProps): ListingLayout => {
  if (!listsShows(settings.kind)) return LISTING_LAYOUTS.files
  if (files.length === 0) return LISTING_LAYOUTS.shows
  return LISTING_LAYOUTS.buckets
}

/**
 * A library's listing laid out: its files, or a TV library's shows, with the
 * files no show was found for in a bucket of their own after them.
 */
export const LibraryListing = ({ settings, shows, files }: LibraryListingProps) => {
  const View = LISTING_VIEWS[listingLayoutOf({ settings, files })]
  return <View settings={settings} shows={shows} files={files} />
}

type ListingBonesProps = { settings: LibrarySettings }

const GRID_BONES = { shows: 'shows', media: 'media' } as const

type GridBonesKey = (typeof GRID_BONES)[keyof typeof GRID_BONES]

const GRID_BONES_VIEWS = {
  [GRID_BONES.shows]: () => <ShowGridSkeleton />,
  [GRID_BONES.media]: ({ settings }: ListingBonesProps) => (
    <MediaGridSkeleton posters={isMovieLibrary(settings)} />
  ),
} as const satisfies Record<GridBonesKey, ComponentType<ListingBonesProps>>

type GridBonesProps = ListingBonesProps

/** Wide show cards for a TV library, else cards. */
const GridBones = ({ settings }: GridBonesProps) => {
  const View = GRID_BONES_VIEWS[listsShows(settings.kind) ? GRID_BONES.shows : GRID_BONES.media]
  return <View settings={settings} />
}

/** Stand-ins shaped as each view lays the listing out: covers, rows, or cards. */
const LISTING_BONES = {
  [LIBRARY_VIEWS.covers]: ({ settings }: ListingBonesProps) => (
    <CoverGridSkeleton posters={matchTypeFor(settings.kind) != null} />
  ),
  [LIBRARY_VIEWS.list]: () => <MediaTilesSkeleton />,
  [LIBRARY_VIEWS.tiles]: () => <MediaTilesSkeleton />,
  [LIBRARY_VIEWS.grid]: GridBones,
  [LIBRARY_VIEWS.grouped]: GridBones,
} as const satisfies Record<LibraryView, ComponentType<ListingBonesProps>>

/** Stand-ins shaped as the listing will be. */
const ListingBones = ({ settings }: ListingBonesProps) => {
  const View = LISTING_BONES[settings.view]
  return <View settings={settings} />
}

type LibraryListingSkeletonProps = { settings: LibrarySettings }

/**
 * The listing while it is on its way, laid out as its view lays it out:
 * bare covers, rows for a list or tiles, wide cards for a TV library's
 * shows, else cards, posters for a Movies library's films.
 */
export const LibraryListingSkeleton = ({ settings }: LibraryListingSkeletonProps) => (
  <Loading
    label={LIBRARY_COPY.gathering(
      listsShows(settings.kind) ? LIBRARY_COPY.shows : LIBRARY_COPY.videos,
    )}
  >
    <ListingBones settings={settings} />
  </Loading>
)
