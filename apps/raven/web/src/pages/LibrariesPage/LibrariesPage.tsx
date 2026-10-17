import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type Library, isScanning } from '@raven/core'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button } from '@raven/ui'
import { LibraryActions, useLibraryActions } from '@/components/LibraryActions/LibraryActions'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { useCanManage } from '@/lib/adminLock'
import { api } from '@/lib/api'
import { librarySettingsEdits } from '@/lib/edits'
import { afterPins } from '@/lib/invalidate'
import { KINDS } from '@/lib/libraryKinds'
import { lockState } from '@/lib/libraryLock'
import { useOptimisticMutation } from '@/lib/optimistic'
import { plural } from '@/lib/plural'
import { librariesQuery, lockQuery } from '@/lib/queries'
import { mutationKeys } from '@/lib/queryClient'
import styles from '@/pages/LibrariesPage/LibrariesPage.module.scss'

const count = new Intl.NumberFormat()

/** How many libraries there are and how many videos they hold between them. */
const summaryOf = (libraries: readonly Library[]): string =>
  [
    plural({ n: libraries.length, one: 'library', many: 'libraries' }),
    plural({
      n: libraries.reduce((sum, library) => sum + library.itemCount, 0),
      one: 'video',
      many: 'videos',
    }),
  ].join(' · ')

/**
 * Pin as a toggle: outlined while off, filled while on, when it reads
 * Pinned. A toggle keeps one name whatever its state, which `aria-pressed`
 * carries, so the word on screen is for the eye and the name stays
 * "Pin" and the library's.
 */
const PinButton = ({ library }: { library: Library }) => {
  const queryClient = useQueryClient()
  // Only the pin is sent; the server keeps the rest of the library as it is.
  // It shows at once, here and in the side menu; home's shelves follow it.
  const pin = useOptimisticMutation({
    mutationKey: mutationKeys.pin,
    mutationFn: (pinned: boolean) => api.setLibraryView({ id: library.id, change: { pinned } }),
    edits: (pinned) => librarySettingsEdits({ libraryId: library.id, change: { pinned } }),
    settle: () => afterPins(queryClient),
  })
  const { pinned } = library.settings

  return (
    <Button
      icon="pin"
      className={styles.pin}
      aria-pressed={pinned}
      onClick={() => pin.mutate(!pinned)}
    >
      <span aria-hidden="true">{pinned ? 'Pinned' : 'Pin'}</span>
      <span className="visually-hidden">Pin {library.name}</span>
    </Button>
  )
}

/**
 * A library's card: its type icon in a well beside its name, its counts,
 * its folders and how its scan stands, and at its right Pin and the
 * library page's own actions. The picture of its newest video fades in at
 * the card's right. While it is locked to this browser it shows only its
 * name, type and counts; the server sends no more, and a list cached from
 * before is held to the same.
 */
const LibraryRow = ({ library, isShut }: { library: Library; isShut: boolean }) => {
  const actions = useLibraryActions(library)
  const backdrop = !isShut && library.backdrop && api.libraryBackdropUrl(library.backdrop)
  const lockNote = isShut ? ' · Locked' : ' · Unlocked'
  const paths = isShut ? [] : library.paths

  return (
    <li className={styles.row}>
      {backdrop && (
        <span className={styles.backdrop} style={{ backgroundImage: `url("${backdrop}")` }} />
      )}
      <div className={styles.details}>
        <span className={styles.well}>
          <LibraryIcon settings={library.settings} size={26} />
        </span>
        <Link to={`/libraries/${library.id}`} className={styles.name}>
          {library.name}
        </Link>
        <span className={styles.count}>
          {KINDS[library.settings.kind].label}
          {library.settings.locked && lockNote} · {count.format(library.itemCount)}{' '}
          {library.itemCount === 1 ? 'video' : 'videos'}
          {library.unmatchedCount > 0 && ` · ${count.format(library.unmatchedCount)} not matched`}
        </span>
        {paths.length > 0 && (
          <ul className={styles.paths} aria-label="Folders">
            {paths.map((path) => (
              <li key={path} className={styles.path}>
                {path}
              </li>
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
          <PinButton library={library} />
          <LibraryActions library={library} isShut={isShut} actions={actions} />
        </div>
      </div>
    </li>
  )
}

/** Three cards on their way, each a line for its name over one for its counts. */
const RowsSkeleton = () => (
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
)

/**
 * `/libraries`: every library as a card, in the order the server keeps
 * them, under a title saying how many there are and how many videos they
 * hold, with Add library at its right while the admin lock is off. With
 * none yet it says what a library is; when the server does not answer it
 * says so and offers to ask again.
 */
export const LibrariesPage = () => {
  const [adding, setAdding] = useState(false)
  const canManage = useCanManage()
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

  const dialog = (
    <AdminOnly>{adding && <LibraryDialog onClose={() => setAdding(false)} />}</AdminOnly>
  )

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
        {libraries.data && <p className={styles.summary}>{summaryOf(libraries.data)}</p>}
        <AdminOnly>
          <Button tone="primary" icon="plus" className={styles.add} onClick={() => setAdding(true)}>
            Add library
          </Button>
        </AdminOnly>
      </header>
      {libraries.isPending ? (
        <RowsSkeleton />
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
