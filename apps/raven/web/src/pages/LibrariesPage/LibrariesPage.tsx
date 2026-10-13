import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type Library, isScanning } from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button/Button'
import { LibraryActions, useLibraryActions } from '@/components/LibraryActions/LibraryActions'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { useAdminLocked } from '@/lib/adminLock'
import { api } from '@/lib/api'
import { librarySettingsEdits } from '@/lib/edits'
import { afterPins } from '@/lib/invalidate'
import { KINDS } from '@/lib/libraryKinds'
import { lockState } from '@/lib/libraryLock'
import { useOptimisticMutation } from '@/lib/optimistic'
import { librariesQuery, lockQuery } from '@/lib/queries'
import { mutationKeys } from '@/lib/queryClient'
import styles from '@/pages/LibrariesPage/LibrariesPage.module.scss'

const count = new Intl.NumberFormat()

/**
 * A library's row: its type icon beside its name, its counts and folders,
 * and its actions, the library page's own with Pin before them. Hovered or
 * focused, the picture of its newest video fades in behind it. While it is
 * locked to this browser it shows only its name, type and counts; the server
 * sends no more, and a list cached from before is held to the same.
 */
const LibraryRow = ({ library, isShut }: { library: Library; isShut: boolean }) => {
  const queryClient = useQueryClient()
  const actions = useLibraryActions(library)
  // Only the pin is sent as a setting; the server keeps the others as they are.
  // It shows at once, here and in the side menu; home's shelves follow it.
  const pin = useOptimisticMutation({
    mutationKey: mutationKeys.pin,
    mutationFn: (pinned: boolean) =>
      api.updateLibrary({
        id: library.id,
        input: { name: library.name, paths: library.paths, settings: { pinned } },
      }),
    edits: (pinned) => librarySettingsEdits({ libraryId: library.id, change: { pinned } }),
    settle: () => afterPins(queryClient),
  })

  const backdrop = !isShut && library.backdrop && api.libraryBackdropUrl(library.backdrop)
  const lockNote = isShut ? ' · Locked' : ' · Unlocked'

  return (
    <li className={styles.row}>
      {backdrop && (
        <span className={styles.backdrop} style={{ backgroundImage: `url("${backdrop}")` }} />
      )}
      <div className={styles.details}>
        <LibraryIcon settings={library.settings} size={28} className={styles.icon} />
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
          {actions.rematch.isError && (
            <p className={styles.error} role="alert">
              Could not match again: {actions.rematch.error.message}
            </p>
          )}
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
          <LibraryActions library={library} isShut={isShut} actions={actions} />
        </div>
      </div>
    </li>
  )
}

export const LibrariesPage = () => {
  const [adding, setAdding] = useState(false)
  const canManage = !useAdminLocked()
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

  const dialog = canManage && adding && <LibraryDialog onClose={() => setAdding(false)} />

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
        {canManage ? (
          <Button tone="primary" icon="plus" onClick={() => setAdding(true)}>
            Add library
          </Button>
        ) : (
          <p>Turn the admin lock off in Settings to add one.</p>
        )}
        {dialog}
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Libraries</h1>
        {canManage && (
          <Button tone="primary" icon="plus" onClick={() => setAdding(true)}>
            Add library
          </Button>
        )}
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
