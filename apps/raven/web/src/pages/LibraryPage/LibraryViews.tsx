import {
  type LibrarySettings,
  type MediaItem,
  type ShowEntry,
  listsShows,
  matchTypeFor,
} from '@raven/core'
import { Bucket } from '@/components/Bucket/Bucket'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { MediaGroups } from '@/components/MediaGroups/MediaGroups'
import { MediaList } from '@/components/MediaList/MediaList'
import { MediaTiles, MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { ShowGrid } from '@/components/ShowCard/ShowCard'
import { ShowList, ShowTiles } from '@/components/ShowCard/ShowViews'
import { Loading } from '@/components/Skeleton/Skeleton'
import { plural } from '@/lib/plural'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** A TV library's shows laid out the way its view setting says; the grouped view is the grid, as the page itself splits matched from not. */
const ShowsView = ({ settings, shows }: { settings: LibrarySettings; shows: ShowEntry[] }) => {
  if (settings.view === 'list') return <ShowList shows={shows} />
  if (settings.view === 'tiles') return <ShowTiles shows={shows} sort={settings.sort} />
  return <ShowGrid shows={shows} ratingsSource={settings.ratingsSource} sort={settings.sort} />
}

/**
 * The library's videos laid out the way its view setting says, a Movies
 * library's as posters, each card or tile showing the value the listing is
 * sorted by. The settings are coherent with the library's type, so a TV
 * library's leftover files are never grouped.
 */
/** A Movies library lays its videos out as posters; any other, as frame grabs. */
const isMovieLibrary = (settings: LibrarySettings): boolean =>
  matchTypeFor(settings.kind) === 'movie'

const MediaView = ({ settings, items }: { settings: LibrarySettings; items: MediaItem[] }) => {
  const matchType = matchTypeFor(settings.kind)
  const movies = isMovieLibrary(settings)
  if (settings.view === 'list')
    return <MediaList items={items} movies={movies} matchType={matchType} />
  if (settings.view === 'tiles')
    return <MediaTiles items={items} posters={movies} matchType={matchType} sort={settings.sort} />
  if (settings.view === 'grouped')
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
  return (
    <MediaGrid
      items={items}
      posters={movies}
      matchType={matchType}
      ratingsSource={settings.ratingsSource}
      sort={settings.sort}
    />
  )
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
      <Bucket label="Not matched" count={plural({ n: files.length, one: 'video', many: 'videos' })}>
        {filesView}
      </Bucket>
    </div>
  )
}

/**
 * The listing while it is on its way, laid out as its view lays it out:
 * rows for a list or tiles, else cards, posters for a TV library's shows
 * and a Movies library's films.
 */
export const LibraryListingSkeleton = ({ settings }: { settings: LibrarySettings }) => (
  <Loading label={`Gathering the ${listsShows(settings.kind) ? 'shows' : 'videos'}`}>
    {settings.view === 'list' || settings.view === 'tiles' ? (
      <MediaTilesSkeleton />
    ) : (
      <MediaGridSkeleton posters={listsShows(settings.kind) || isMovieLibrary(settings)} />
    )}
  </Loading>
)
