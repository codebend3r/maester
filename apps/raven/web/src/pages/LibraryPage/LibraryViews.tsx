import {
  type LibrarySettings,
  type MediaItem,
  type ShowEntry,
  listsShows,
  matchTypeFor,
} from '@raven/core'
import { Bucket } from '@/components/Bucket/Bucket'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { MediaGroups } from '@/components/MediaGroups/MediaGroups'
import { MediaList } from '@/components/MediaList/MediaList'
import { MediaTiles } from '@/components/MediaTiles/MediaTiles'
import { ShowGrid } from '@/components/ShowCard/ShowCard'
import { ShowList, ShowTiles } from '@/components/ShowCard/ShowViews'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const count = new Intl.NumberFormat()

/** A TV library's shows laid out the way its view setting says; the grouped view is the grid, as the page itself splits matched from not. */
const ShowsView = ({
  settings,
  shows,
  busy,
}: {
  settings: LibrarySettings
  shows: ShowEntry[]
  busy: boolean
}) => {
  if (settings.view === 'list') return <ShowList shows={shows} busy={busy} />
  if (settings.view === 'tiles') return <ShowTiles shows={shows} busy={busy} sort={settings.sort} />
  return (
    <ShowGrid
      shows={shows}
      busy={busy}
      ratingsSource={settings.ratingsSource}
      sort={settings.sort}
    />
  )
}

/**
 * The library's videos laid out the way its view setting says, a Movies
 * library's as posters, each card or tile showing the value the listing is
 * sorted by. The settings are coherent with the library's type, so a TV
 * library's leftover files are never grouped.
 */
const MediaView = ({
  settings,
  items,
  busy,
}: {
  settings: LibrarySettings
  items: MediaItem[]
  busy: boolean
}) => {
  const matchType = matchTypeFor(settings.kind)
  const movies = matchType === 'movie'
  if (settings.view === 'list')
    return <MediaList items={items} busy={busy} movies={movies} matchType={matchType} />
  if (settings.view === 'tiles')
    return (
      <MediaTiles
        items={items}
        busy={busy}
        posters={movies}
        matchType={matchType}
        sort={settings.sort}
      />
    )
  if (settings.view === 'grouped')
    return (
      <MediaGroups
        items={items}
        by={settings.groupBy}
        busy={busy}
        posters={movies}
        matchType={matchType}
        ratingsSource={settings.ratingsSource}
        sort={settings.sort}
      />
    )
  return (
    <MediaGrid
      items={items}
      busy={busy}
      posters={movies}
      matchType={matchType}
      ratingsSource={settings.ratingsSource}
      sort={settings.sort}
    />
  )
}

const plural = ({ n, one, many }: { n: number; one: string; many: string }): string =>
  `${count.format(n)} ${n === 1 ? one : many}`

/**
 * A library's listing laid out: its files, or a TV library's shows, with the
 * files no show was found for in a bucket of their own after them.
 */
export const LibraryListing = ({
  settings,
  shows,
  files,
  busy,
}: {
  settings: LibrarySettings
  shows: ShowEntry[]
  files: MediaItem[]
  busy: boolean
}) => {
  const filesView = <MediaView settings={settings} items={files} busy={busy} />
  if (!listsShows(settings.kind)) return filesView
  const showsView = <ShowsView settings={settings} shows={shows} busy={busy} />
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
