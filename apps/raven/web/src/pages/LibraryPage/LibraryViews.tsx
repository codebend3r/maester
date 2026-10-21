import {
  ITEM_TYPES,
  LIBRARY_VIEWS,
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
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** A TV library's shows laid out the way its view setting says; the grouped view is the grid, as the page itself splits matched from not. */
const ShowsView = ({ settings, shows }: { settings: LibrarySettings; shows: ShowEntry[] }) => {
  switch (settings.view) {
    case LIBRARY_VIEWS.list:
      return <ShowList shows={shows} />
    case LIBRARY_VIEWS.covers:
      return <ShowCovers shows={shows} />
    case LIBRARY_VIEWS.tiles:
      return <ShowTiles shows={shows} sort={settings.sort} />
    case LIBRARY_VIEWS.grid:
    case LIBRARY_VIEWS.grouped:
      return <ShowGrid shows={shows} ratingsSource={settings.ratingsSource} sort={settings.sort} />
    default: {
      const unknown: never = settings.view
      return unknown
    }
  }
}

/** A Movies library lays its videos out as posters; any other, as frame grabs. */
const isMovieLibrary = (settings: LibrarySettings): boolean =>
  matchTypeFor(settings.kind) === ITEM_TYPES.movie

/**
 * The library's videos laid out the way its view setting says, a Movies
 * library's as posters, each card or tile showing the value the listing is
 * sorted by. The settings are coherent with the library's type, so a TV
 * library's leftover files are never grouped.
 */
const MediaView = ({ settings, items }: { settings: LibrarySettings; items: MediaItem[] }) => {
  const matchType = matchTypeFor(settings.kind)
  const movies = isMovieLibrary(settings)
  switch (settings.view) {
    case LIBRARY_VIEWS.list:
      return <MediaList items={items} movies={movies} matchType={matchType} />
    case LIBRARY_VIEWS.covers:
      return <MediaCovers items={items} posters={movies} />
    case LIBRARY_VIEWS.tiles:
      return (
        <MediaTiles items={items} posters={movies} matchType={matchType} sort={settings.sort} />
      )
    case LIBRARY_VIEWS.grouped:
      return (
        <MediaGroups
          items={items}
          by={settings.groupBy}
          posters={movies}
          matchType={matchType}
          ratingsSource={settings.ratingsSource}
          sort={settings.sort}
        />
      )
    case LIBRARY_VIEWS.grid:
      return (
        <MediaGrid
          items={items}
          posters={movies}
          matchType={matchType}
          ratingsSource={settings.ratingsSource}
          sort={settings.sort}
        />
      )
    default: {
      const unknown: never = settings.view
      return unknown
    }
  }
}

/**
 * A library's listing laid out: its files, or a TV library's shows, with the
 * files no show was found for in a bucket of their own after them.
 */
export const LibraryListing = ({
  settings,
  shows,
  files,
}: {
  settings: LibrarySettings
  shows: ShowEntry[]
  files: MediaItem[]
}) => {
  const filesView = <MediaView settings={settings} items={files} />
  if (!listsShows(settings.kind)) return filesView
  const showsView = <ShowsView settings={settings} shows={shows} />
  if (files.length === 0) return showsView
  return (
    <div className={styles.buckets}>
      {shows.length > 0 && (
        <Bucket label="Matched" count={plural({ n: shows.length, one: 'show', many: 'shows' })}>
          {showsView}
        </Bucket>
      )}
      <Bucket
        label="Not matched"
        count={plural({ n: unmatchedShowsOf(files).length, one: 'show', many: 'shows' })}
      >
        <UnmatchedShows
          files={files}
          renderFiles={(group) => <MediaView settings={settings} items={group} />}
        />
      </Bucket>
    </div>
  )
}

/** Stand-ins shaped as the listing will be: covers, rows, a TV library's wide show cards, or cards. */
const ListingBones = ({ settings }: { settings: LibrarySettings }) => {
  switch (settings.view) {
    case LIBRARY_VIEWS.covers:
      return <CoverGridSkeleton posters={matchTypeFor(settings.kind) != null} />
    case LIBRARY_VIEWS.list:
    case LIBRARY_VIEWS.tiles:
      return <MediaTilesSkeleton />
    case LIBRARY_VIEWS.grid:
    case LIBRARY_VIEWS.grouped:
      if (listsShows(settings.kind)) return <ShowGridSkeleton />
      return <MediaGridSkeleton posters={isMovieLibrary(settings)} />
    default: {
      const unknown: never = settings.view
      return unknown
    }
  }
}

/**
 * The listing while it is on its way, laid out as its view lays it out:
 * bare covers, rows for a list or tiles, wide cards for a TV library's
 * shows, else cards, posters for a Movies library's films.
 */
export const LibraryListingSkeleton = ({ settings }: { settings: LibrarySettings }) => (
  <Loading label={`Gathering the ${listsShows(settings.kind) ? 'shows' : 'videos'}`}>
    <ListingBones settings={settings} />
  </Loading>
)
