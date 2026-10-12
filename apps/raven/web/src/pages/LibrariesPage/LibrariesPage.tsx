import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Library, isLibrary, isScanning } from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button/Button'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { api } from '@/lib/api'
import { KINDS } from '@/lib/libraryKinds'
import { lockState } from '@/lib/libraryLock'
import { optimisticChange, patchEvery, patchQueries } from '@/lib/optimistic'
import { librariesQuery, lockQuery } from '@/lib/queries'
import { mutationKeys, queryKeys } from '@/lib/queryClient'
import styles from '@/pages/LibrariesPage/LibrariesPage.module.scss'

const count = new Intl.NumberFormat()

/**
 * A library's row: its type icon beside its name, its counts and folders,
 * and its actions. Hovered or focused, the picture of its newest video
 * fades in behind it. While it is locked to this browser it shows only its
 * name, type and counts; the server sends no more, and a list cached from
 * before is held to the same.
 */
const LibraryRow = ({ library, isShut }: { library: Library; isShut: boolean }) => {
  const queryClient = useQueryClient()
  const rescan = useMutation({
    mutationFn: () => api.scanLibrary(library.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
  })
  // Only the pin is sent as a setting; the server keeps the others as they are.
  // It shows at once, here and in the side menu; home's shelves follow it.
  const pin = useMutation({
    mutationFn: (pinned: boolean) =>
      api.updateLibrary({
        id: library.id,
        input: { name: library.name, paths: library.paths, settings: { pinned } },
      }),
    ...optimisticChange<boolean>({
      queryClient,
      mutationKey: mutationKeys.pin(library.id),
      apply: (pinned) =>
        patchQueries({
          queryClient,
          filters: [
            { queryKey: queryKeys.libraries, exact: true },
            { queryKey: queryKeys.library(library.id), exact: true },
          ],
          patch: patchEvery({
            guard: isLibrary,
            id: library.id,
            patch: (current) => ({ ...current, settings: { ...current.settings, pinned } }),
          }),
        }),
      settle: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
          queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        ]),
    }),
  })

  const backdrop = !isShut && library.backdrop && api.libraryBackdropUrl(library.backdrop)
  const lockNote = isShut ? ' · Locked' : ' · Unlocked'

  return (
    <li className={styles.row}>
      {backdrop && (
        <span className={styles.backdrop} style={{ backgroundImage: `url("${backdrop}")` }} />
      )}
      <div className={styles.details}>
        <LibraryIcon
          kind={library.settings.kind}
          isLocked={library.settings.locked}
          size={28}
          className={styles.icon}
        />
        <Link to={`/libraries/${library.id}`} className={styles.name}>
          {library.name}
        </Link>
        <span className={styles.count}>
          {KINDS[library.settings.kind].label}
          {library.settings.locked && lockNote} · {count.format(library.itemCount)}{' '}
          {library.itemCount === 1 ? 'video' : 'videos'}
          {library.unmatchedCount > 0 && ` · ${count.format(library.unmatchedCount)} not matched`}
        </span>
        {!isShut && (
          <ul className={styles.paths} aria-label="Folders">
            {library.paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        )}
        <div className={styles.status}>
          <ScanStatus scan={library.scan} />
        </div>
        <div className={styles.actions}>
          <Button
            icon="pin"
            className={styles.pin}
            aria-pressed={library.settings.pinned}
            onClick={() => pin.mutate(!library.settings.pinned)}
          >
            Pin<span className="visually-hidden"> {library.name}</span>
          </Button>
          <Button
            icon="rescan"
            disabled={isScanning(library.scan) || rescan.isPending}
            onClick={() => rescan.mutate()}
          >
            Rescan
          </Button>
        </div>
      </div>
    </li>
  )
}

export const LibrariesPage = () => {
  const [adding, setAdding] = useState(false)
  const libraries = useQuery({
    ...librariesQuery,
    // Poll only while something is scanning, so the counts climb live.
    refetchInterval: (query) =>
      query.state.data?.some((library) => isScanning(library.scan)) ? 1500 : false,
  })

  // Whether this browser holds the PIN, asked only when some library is locked.
  const lock = useQuery({
    ...lockQuery,
    enabled: (libraries.data ?? []).some((library) => library.settings.locked),
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
        <h1 className={styles.emptyTitle}>Point raven at your videos</h1>
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
      {libraries.isPending ? (
        <Loading label="Gathering your libraries">
          <ul className={styles.list}>
            {['first', 'second', 'third'].map((row) => (
              <li key={row} className={styles.rowSkeleton}>
                <Bone shape="heading" width="half" />
                <Bone shape="small" width="short" />
              </li>
            ))}
          </ul>
        </Loading>
      ) : (
        <ul className={styles.list}>
          {(libraries.data ?? []).map((library) => (
            <LibraryRow
              key={library.id}
              library={library}
              isShut={
                lockState({ locked: library.settings.locked, lock: lock.data }).state !== 'open'
              }
            />
          ))}
        </ul>
      )}
      {dialog}
    </section>
  )
}
