import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, type MediaSort } from '@raven/core'
import { useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const count = new Intl.NumberFormat()

const isSort = (value: string): value is MediaSort => value === 'title' || value === 'added'

export const LibraryPage = () => {
  const params = useParams()
  const libraryId = Number(params.id)
  const ids = { search: useId(), sort: useId() }
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<MediaSort>('title')
  const [editing, setEditing] = useState(false)
  const query = useDebouncedValue({ value: search.trim(), delayMs: 200 })

  const library = useQuery({
    queryKey: queryKeys.library(libraryId),
    queryFn: () => api.getLibrary(libraryId),
    enabled: Number.isInteger(libraryId),
    refetchInterval: (current) => (current.state.data?.scan.state === 'scanning' ? 1500 : false),
  })
  const scanning = library.data?.scan.state === 'scanning'

  const media = useQuery({
    queryKey: queryKeys.media({ libraryId, search: query, sort }),
    queryFn: () => api.listMedia({ libraryId, search: query, sort }),
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

  return (
    <section className={styles.page} aria-labelledby={`${ids.search}-title`}>
      <ButtonLink to="/" icon="back" className={styles.back}>
        Libraries
      </ButtonLink>

      <header className={styles.header}>
        <h1 id={`${ids.search}-title`} className={styles.title}>
          {library.data.name}
        </h1>
        <p className={styles.count}>
          {count.format(library.data.itemCount)} {library.data.itemCount === 1 ? 'video' : 'videos'}
        </p>
        <div className={styles.status}>
          <ScanStatus scan={library.data.scan} />
        </div>
        <div className={styles.actions}>
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

      <search className={styles.toolbar}>
        <label htmlFor={ids.search} className="visually-hidden">
          Search {library.data.name}
        </label>
        <input
          id={ids.search}
          type="search"
          className={styles.search}
          placeholder={`Search ${library.data.name}`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label htmlFor={ids.sort} className={styles.sortLabel}>
          Sort
        </label>
        <select
          id={ids.sort}
          className={styles.sort}
          value={sort}
          onChange={(event) => isSort(event.target.value) && setSort(event.target.value)}
        >
          <option value="title">Title</option>
          <option value="added">Recently added</option>
        </select>
      </search>

      {emptyState ? (
        <p className={styles.message}>{emptyState}</p>
      ) : (
        <MediaGrid items={items} busy={media.isFetching && !media.data} />
      )}

      {editing && <LibraryDialog library={library.data} onClose={() => setEditing(false)} />}
    </section>
  )
}
