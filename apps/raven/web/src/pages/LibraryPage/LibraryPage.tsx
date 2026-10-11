import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  DEFAULT_LIBRARY_SETTINGS,
  type Library,
  type LibrarySettings,
  type MediaItem,
  groupMedia,
} from '@raven/core'
import { useId, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { LibraryToolbar } from '@/components/LibraryToolbar/LibraryToolbar'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { MediaGroups } from '@/components/MediaGroups/MediaGroups'
import { MediaList } from '@/components/MediaList/MediaList'
import { MediaTiles } from '@/components/MediaTiles/MediaTiles'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
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
    ? groupMedia({ items, by: settings.groupBy })
        .flatMap((group) => group.items)
        .at(0)
    : items.at(0)

/** The library's videos laid out the way its view setting says. */
const MediaView = ({
  settings,
  items,
  busy,
}: {
  settings: LibrarySettings
  items: MediaItem[]
  busy: boolean
}) => {
  if (settings.view === 'list') return <MediaList items={items} busy={busy} />
  if (settings.view === 'tiles') return <MediaTiles items={items} busy={busy} />
  if (settings.view === 'grouped')
    return <MediaGroups items={items} by={settings.groupBy} busy={busy} />
  return <MediaGrid items={items} busy={busy} />
}

export const LibraryPage = () => {
  const params = useParams()
  const libraryId = Number(params.id)
  const ids = { title: useId() }
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
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
  const settings = library.data?.settings ?? DEFAULT_LIBRARY_SETTINGS
  const sort = settings.sort
  const dealt = sort === 'random' ? seed : 0

  const media = useQuery({
    queryKey: queryKeys.media({ libraryId, search: query, sort, seed: dealt }),
    queryFn: () => api.listMedia({ libraryId, search: query, sort, seed: dealt }),
    enabled: library.isSuccess,
    placeholderData: keepPreviousData,
    // While a scan runs or thumbnails are still being made, keep the grid filling in.
    refetchInterval: (current) =>
      scanning || current.state.data?.some((item) => item.thumbnail === 'pending') ? 3000 : false,
  })

  const rescan = useMutation({
    mutationFn: () => api.scanLibrary(libraryId),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.library(libraryId), updated)
      return queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
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

  const items = media.data ?? []
  const emptyState = ((): string | null => {
    if (!media.isSuccess || items.length > 0) return null
    if (query) return `Nothing here matches "${query}".`
    if (scanning) return 'Looking through the folders. Videos appear here as they are found.'
    return 'No videos in these folders yet. Check the paths, or add a folder that holds videos.'
  })()

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
          if (library.data) saveSettings.mutate({ current: library.data, change })
        }}
        playable={items.length > 0}
        onPlay={() => watch(firstShown({ settings, items }))}
        onShuffle={() => watch(items.at(Math.floor(Math.random() * items.length)))}
      />

      {saveSettings.isError && (
        <p className={styles.message} role="alert">
          Could not save how this library is shown: {saveSettings.error.message}
        </p>
      )}

      {emptyState ? (
        <p className={styles.message}>{emptyState}</p>
      ) : (
        <MediaView settings={settings} items={items} busy={media.isFetching && !media.data} />
      )}

      {editing && <LibraryDialog library={library.data} onClose={() => setEditing(false)} />}
    </section>
  )
}
