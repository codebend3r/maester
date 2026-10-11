import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  DEFAULT_LIBRARY_SETTINGS,
  groupMedia,
  isLibraryView,
  isMediaGroupBy,
  isMediaSort,
  type Library,
  type LibraryKind,
  type LibrarySettings,
  type MediaItem,
  type ShowEntry,
} from '@raven/core'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bucket } from '@/components/Bucket/Bucket'
import { Button, ButtonLink } from '@/components/Button/Button'
import type { MatchType } from '@/components/FixMatchDialog/FixMatchDialog'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { LibraryToolbar } from '@/components/LibraryToolbar/LibraryToolbar'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { MediaGroups } from '@/components/MediaGroups/MediaGroups'
import { MediaList } from '@/components/MediaList/MediaList'
import { MediaTiles } from '@/components/MediaTiles/MediaTiles'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { ShowGrid } from '@/components/ShowCard/ShowCard'
import { ShowList, ShowTiles } from '@/components/ShowCard/ShowViews'
import { api } from '@/lib/api'
import { KIND_LABELS } from '@/lib/libraryKinds'
import { queryKeys } from '@/lib/queryClient'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const count = new Intl.NumberFormat()

/** A fresh deal for a random sort; the order holds while the page is open. */
const dealSeed = (): number => Math.floor(Math.random() * 2 ** 31)

/** The video the page shows first: in the grouped view, the top of the first bucket. */
const firstShown = ({
  settings,
  items,
}: {
  settings: LibrarySettings
  items: MediaItem[]
}): MediaItem | undefined =>
  settings.view === 'grouped'
    ? groupMedia({
        items,
        by:
          settings.groupBy === 'match' && settings.kind === 'other'
            ? 'resolution'
            : settings.groupBy,
      })
        .flatMap((group) => group.items)
        .at(0)
    : items.at(0)

/**
 * The view the address carries, `?q=&sort=&view=&group=`, so a refresh or a
 * shared link lands on the same search, order and layout; what the address
 * leaves out comes from the library's own settings.
 */
const viewFromUrl = (params: URLSearchParams): Partial<LibrarySettings> => {
  const sort = params.get('sort')
  const view = params.get('view')
  const group = params.get('group')
  return {
    ...(isMediaSort(sort) ? { sort } : {}),
    ...(isLibraryView(view) ? { view } : {}),
    ...(isMediaGroupBy(group) ? { groupBy: group } : {}),
  }
}

/** The address with `change` written into it. */
const writeView = ({
  params,
  change,
}: {
  params: URLSearchParams
  change: Partial<LibrarySettings>
}): URLSearchParams => {
  const next = new URLSearchParams(params)
  if (change.sort != null) next.set('sort', change.sort)
  if (change.view != null) next.set('view', change.view)
  if (change.groupBy != null) next.set('group', change.groupBy)
  return next
}

/** What a library's files are matched to, for the cards' Fix match. */
const matchTypeOf = (kind: LibraryKind): MatchType | null =>
  kind === 'movies' ? 'movie' : kind === 'shows' ? 'show' : null

/** A TV library's shows laid out the way its view setting says; the grouped view is the grid, as the page itself splits matched from not. */
const ShowsView = ({
  settings,
  shows,
  busy,
  labelledBy,
}: {
  settings: LibrarySettings
  shows: ShowEntry[]
  busy: boolean
  labelledBy: string | undefined
}) => {
  const props = { shows, busy, ratingsSource: settings.ratingsSource, labelledBy }
  if (settings.view === 'list') return <ShowList {...props} />
  if (settings.view === 'tiles') return <ShowTiles {...props} />
  return <ShowGrid {...props} />
}

/**
 * The library's videos laid out the way its view setting says: a Movies
 * library's as posters, and a TV library's leftover files never grouped.
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
  const movies = settings.kind === 'movies'
  const matchType = matchTypeOf(settings.kind)
  if (settings.view === 'list')
    return <MediaList items={items} busy={busy} movies={movies} matchType={matchType} />
  if (settings.view === 'tiles')
    return <MediaTiles items={items} busy={busy} posters={movies} matchType={matchType} />
  if (settings.view === 'grouped' && settings.kind !== 'shows')
    return (
      <MediaGroups
        items={items}
        by={
          settings.groupBy === 'match' && settings.kind === 'other'
            ? 'resolution'
            : settings.groupBy
        }
        busy={busy}
        posters={movies}
        matchType={matchType}
        ratingsSource={settings.ratingsSource}
      />
    )
  return (
    <MediaGrid
      items={items}
      busy={busy}
      posters={movies}
      matchType={matchType}
      ratingsSource={settings.ratingsSource}
    />
  )
}

export const LibraryPage = () => {
  const params = useParams()
  const libraryId = Number(params.id)
  const ids = { title: useId() }
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [address, setAddress] = useSearchParams()
  const [search, setSearch] = useState(address.get('q') ?? '')
  const [seed] = useState(dealSeed)
  const [editing, setEditing] = useState(false)
  const query = useDebouncedValue({ value: search.trim(), delayMs: 200 })

  const library = useQuery({
    queryKey: queryKeys.library(libraryId),
    queryFn: () => api.getLibrary(libraryId),
    enabled: Number.isInteger(libraryId),
    refetchInterval: (current) => (current.state.data?.scan.state === 'scanning' ? 1500 : false),
  })
  const scanning = library.data?.scan.state === 'scanning'
  const saved = library.data?.settings ?? DEFAULT_LIBRARY_SETTINGS
  const settings = { ...saved, ...viewFromUrl(address) }

  // The search rides in the address once it settles, replacing rather than
  // stacking history entries as the viewer types.
  useEffect(() => {
    setAddress(
      (current) => {
        const next = new URLSearchParams(current)
        if (query) next.set('q', query)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }, [query, setAddress])
  const sort = settings.sort
  const dealt = sort === 'random' ? seed : 0
  // Files only leave pending while TMDB answers; without it they wait for good.
  const metadata = useQuery({
    queryKey: queryKeys.metadataHealth,
    queryFn: api.getMetadataHealth,
    enabled: settings.kind !== 'other',
    staleTime: 60_000,
  })
  const matching = metadata.data?.tmdb === 'ok'
  const tv = settings.kind === 'shows'

  // A TV library lists its shows, with the files no show was found for after.
  const showsQuery = useQuery({
    queryKey: queryKeys.shows({ libraryId, search: query, sort, seed: dealt }),
    queryFn: () => api.listShows({ libraryId, search: query, sort, seed: dealt }),
    enabled: library.isSuccess && tv,
    placeholderData: keepPreviousData,
    refetchInterval: (current) =>
      scanning ||
      (matching && current.state.data?.unmatched.some((item) => item.match === 'pending'))
        ? 3000
        : false,
  })

  const media = useQuery({
    queryKey: queryKeys.media({ libraryId, search: query, sort, seed: dealt }),
    queryFn: () => api.listMedia({ libraryId, search: query, sort, seed: dealt }),
    enabled: library.isSuccess && !tv,
    placeholderData: keepPreviousData,
    // While a scan runs, or thumbnails are still being made or files matched, keep the grid filling in.
    refetchInterval: (current) =>
      scanning ||
      current.state.data?.some(
        (item) => item.thumbnail === 'pending' || (matching && item.match === 'pending'),
      )
        ? 3000
        : false,
  })

  // Nothing else reads the library again after a matching pass, so its count
  // of files not matched is refetched once the listing has none pending.
  const isMatchingFiles = tv
    ? !!showsQuery.data?.unmatched.some((item) => item.match === 'pending')
    : !!media.data?.some((item) => item.match === 'pending')
  const wasMatchingFiles = useRef(false)
  useEffect(() => {
    if (wasMatchingFiles.current && !isMatchingFiles) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library(libraryId), exact: true })
      void queryClient.invalidateQueries({ queryKey: queryKeys.libraries, exact: true })
    }
    wasMatchingFiles.current = isMatchingFiles
  }, [isMatchingFiles, libraryId, queryClient])

  const rescan = useMutation({
    mutationFn: () => api.scanLibrary(libraryId),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(libraryId), updated)
      return queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
    },
  })

  // Match again sends the files no movie or show was found for back to TMDB;
  // the listing then polls while any of them is pending.
  const rematch = useMutation({
    mutationFn: () => api.matchLibrary(libraryId),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(libraryId), updated)
      return queryClient.invalidateQueries({
        queryKey: tv ? queryKeys.showLists(libraryId) : queryKeys.mediaLists(libraryId),
      })
    },
  })

  // Sort, view and grouping switch at once and save behind; a failed save
  // puts the library back as it was and says so.
  const saveSettings = useMutation({
    mutationFn: ({ current, change }: { current: Library; change: Partial<LibrarySettings> }) =>
      api.updateLibrary({
        id: current.id,
        input: { name: current.name, paths: current.paths, settings: change },
      }),
    onMutate: async ({ current, change }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.library(libraryId), exact: true })
      queryClient.setQueryData<Library>(queryKeys.library(libraryId), {
        ...current,
        settings: { ...current.settings, ...change },
      })
      return { previous: current }
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(queryKeys.library(libraryId), context.previous)
    },
    onSuccess: (updated) => queryClient.setQueryData(queryKeys.library(libraryId), updated),
  })

  const missing = library.error instanceof ApiError && library.error.status === 404
  if (!Number.isInteger(libraryId) || missing) {
    return <NotFoundPage />
  }
  if (library.isError) {
    return (
      <p className={styles.message} role="alert">
        {library.error.message}
      </p>
    )
  }
  if (!library.data) return <p className={styles.message}>Opening the library</p>

  const shows = showsQuery.data?.shows ?? []
  const items = tv ? (showsQuery.data?.unmatched ?? []) : (media.data ?? [])
  const loaded = tv ? showsQuery.isSuccess : media.isSuccess
  const unmatched = library.data.unmatchedCount
  const emptyState = ((): string | null => {
    if (!loaded || items.length > 0 || shows.length > 0) return null
    if (query) return `Nothing here matches "${query}".`
    if (scanning) return 'Looking through the folders. Videos appear here as they are found.'
    return 'No videos in these folders yet. Check the paths, or add a folder that holds videos.'
  })()
  // In a TV library, Play and Shuffle start a show's next episode.
  const playable = tv
    ? shows.some((entry) => entry.next != null) || items.length > 0
    : items.length > 0
  const firstPlayable = (): MediaItem | undefined =>
    tv
      ? (shows.find((entry) => entry.next != null)?.next ?? items.at(0))
      : firstShown({ settings, items })
  const randomPlayable = (): MediaItem | undefined => {
    const choices = tv ? [...shows.flatMap((entry) => entry.next ?? []), ...items] : items
    return choices.at(Math.floor(Math.random() * choices.length))
  }

  // The item rides along in router state, as a card click hands it over, so
  // the player starts without fetching it again.
  const watch = (item: MediaItem | undefined) => {
    if (item) navigate(`/watch/${item.id}`, { state: { media: item } })
  }

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <ButtonLink to="/" icon="back" className={styles.back}>
        Libraries
      </ButtonLink>

      <header className={styles.header}>
        <h1 id={ids.title} className={styles.title}>
          {library.data.name}
        </h1>
        <p className={styles.count}>
          {KIND_LABELS[settings.kind]} · {count.format(library.data.itemCount)}{' '}
          {library.data.itemCount === 1 ? 'video' : 'videos'}
          {unmatched > 0 && ` · ${count.format(unmatched)} not matched`}
        </p>
        <div className={styles.status}>
          <ScanStatus scan={library.data.scan} />
        </div>
        <div className={styles.actions}>
          <ButtonLink to={`/libraries/${libraryId}/history`} icon="history">
            History
          </ButtonLink>
          <Button
            icon="rescan"
            disabled={scanning || rescan.isPending}
            onClick={() => rescan.mutate()}
          >
            Rescan
          </Button>
          {settings.kind !== 'other' && (
            <Button
              icon="search"
              disabled={!matching || unmatched === 0 || rematch.isPending}
              title={`Search TMDB again for the files no ${tv ? 'show' : 'movie'} was found for`}
              onClick={() => rematch.mutate()}
            >
              Match again
            </Button>
          )}
          <Button icon="edit" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </header>

      <LibraryToolbar
        name={library.data.name}
        search={search}
        onSearch={setSearch}
        settings={settings}
        onChange={(change) => {
          setAddress(writeView({ params: address, change }), { replace: true })
          if (library.data) saveSettings.mutate({ current: library.data, change })
        }}
        playable={playable}
        onPlay={() => watch(firstPlayable())}
        onShuffle={() => watch(randomPlayable())}
      />

      {saveSettings.isError && (
        <p className={styles.message} role="alert">
          Could not save how this library is shown: {saveSettings.error.message}
        </p>
      )}
      {rematch.isError && (
        <p className={styles.message} role="alert">
          Could not match again: {rematch.error.message}
        </p>
      )}

      {emptyState && <p className={styles.message}>{emptyState}</p>}
      {!emptyState && tv && items.length === 0 && (
        <ShowsView
          settings={settings}
          shows={shows}
          busy={showsQuery.isFetching && !showsQuery.data}
          labelledBy={undefined}
        />
      )}
      {!emptyState && tv && items.length > 0 && (
        <div className={styles.buckets}>
          {shows.length > 0 && (
            <Bucket
              label="Matched"
              count={`${count.format(shows.length)} ${shows.length === 1 ? 'show' : 'shows'}`}
            >
              <ShowsView
                settings={settings}
                shows={shows}
                busy={showsQuery.isFetching && !showsQuery.data}
                labelledBy={undefined}
              />
            </Bucket>
          )}
          <Bucket
            label="Not matched"
            count={`${count.format(items.length)} ${items.length === 1 ? 'video' : 'videos'}`}
          >
            <MediaView settings={settings} items={items} busy={false} />
          </Bucket>
        </div>
      )}
      {!emptyState && !tv && (
        <MediaView settings={settings} items={items} busy={media.isFetching && !media.data} />
      )}

      {editing && <LibraryDialog library={library.data} onClose={() => setEditing(false)} />}
    </section>
  )
}
