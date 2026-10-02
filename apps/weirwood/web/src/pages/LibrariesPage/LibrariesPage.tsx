import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Library } from '@weirwood/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button/Button'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import styles from './LibrariesPage.module.scss'

const count = new Intl.NumberFormat()

const LibraryRow = ({ library }: { library: Library }) => {
  const queryClient = useQueryClient()
  const rescan = useMutation({
    mutationFn: () => api.scanLibrary(library.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
  })

  return (
    <li className={styles.row}>
      <Link to={`/libraries/${library.id}`} className={styles.name}>
        {library.name}
      </Link>
      <span className={styles.count}>
        {count.format(library.itemCount)} {library.itemCount === 1 ? 'video' : 'videos'}
      </span>
      <ul className={styles.paths} aria-label="Folders">
        {library.paths.map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
      <div className={styles.status}>
        <ScanStatus scan={library.scan} />
      </div>
      <Button
        icon="rescan"
        className={styles.rescan}
        disabled={library.scan.state === 'scanning' || rescan.isPending}
        onClick={() => rescan.mutate()}
      >
        Rescan
      </Button>
    </li>
  )
}

export const LibrariesPage = () => {
  const [adding, setAdding] = useState(false)
  const libraries = useQuery({
    queryKey: queryKeys.libraries,
    queryFn: api.listLibraries,
    // Poll only while something is scanning, so the counts climb live.
    refetchInterval: (query) =>
      query.state.data?.some((library) => library.scan.state === 'scanning') ? 1500 : false,
  })

  const dialog = adding && <LibraryDialog onClose={() => setAdding(false)} />

  if (libraries.isError) {
    return (
      <section className={styles.empty}>
        <h1 className={styles.emptyTitle}>The server did not answer</h1>
        <p role="alert">{libraries.error.message}</p>
        <Button onClick={() => libraries.refetch()}>Try again</Button>
      </section>
    )
  }

  if (libraries.data?.length === 0) {
    return (
      <section className={styles.empty}>
        <h1 className={styles.emptyTitle}>Point weirwood at your videos</h1>
        <p>
          A library is a set of folders. Pick the ones that hold your movies or shows, and every
          video inside is indexed, given a thumbnail, and ready to play.
        </p>
        <Button tone="primary" icon="plus" onClick={() => setAdding(true)}>
          Add library
        </Button>
        {dialog}
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Libraries</h1>
        <Button tone="primary" icon="plus" onClick={() => setAdding(true)}>
          Add library
        </Button>
      </header>
      <ul className={styles.list} aria-busy={libraries.isPending}>
        {(libraries.data ?? []).map((library) => (
          <LibraryRow key={library.id} library={library} />
        ))}
      </ul>
      {dialog}
    </section>
  )
}
