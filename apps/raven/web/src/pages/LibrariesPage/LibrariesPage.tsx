import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KINDS, type Library, plural } from '@raven/core'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { Button } from '@raven/ui'
import {
  LibraryActionErrors,
  LibraryActions,
  useLibraryActions,
} from '@/components/LibraryActions/LibraryActions'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import { RatingsStatus } from '@/components/RatingsStatus/RatingsStatus'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { cannotManageNote, useCanManage, useManagement } from '@/lib/management'
import { api } from '@/lib/api'
import {
  afterHeroLibraries,
  afterPins,
  librarySettingsEdits,
  mutationKeys,
  useOptimisticMutation,
} from '@raven/ui/headless'
import { foldersByParent } from '@/lib/folders'
import { libraryPollDelay } from '@/lib/libraryPolling'
import { LIBRARY_LOCK_STATES, lockState } from '@/lib/libraryLock'
import { useLibraryOrdering } from '@/lib/useLibraryOrdering'
import { librariesQuery, lockQuery } from '@/lib/queries'
import { OrderedLibraries } from '@/pages/LibrariesPage/OrderedLibraries'
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

type PinButtonProps = { library: Library }

/**
 * Pin as a toggle: outlined while off, filled while on, when it reads
 * Pinned. A toggle keeps one name whatever its state, which `aria-pressed`
 * carries, so the word on screen is for the eye and the name stays
 * "Pin" and the library's.
 */
const PinButton = ({ library }: PinButtonProps) => {
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
      title={
        pinned
          ? 'Pinned: this library has its own link in the side menu and a row on Home. Press to unpin it.'
          : 'Pin this library: give it its own link in the side menu and a row on Home.'
      }
      onClick={() => pin.mutate(!pinned)}
    >
      <span aria-hidden="true">{pinned ? 'Pinned' : 'Pin'}</span>
      <span className="visually-hidden">Pin {library.name}</span>
    </Button>
  )
}

type HeroCheckboxProps = { library: Library }

/**
 * Whether home's hero may show this library's titles. The admin's, so it
 * mounts inside `AdminOnly`; it shows at once and the server's answer settles it.
 * A locked library is never in the hero, so its box stays off and cannot be ticked.
 */
const HeroCheckbox = ({ library }: HeroCheckboxProps) => {
  const queryClient = useQueryClient()
  const id = useId()
  const include = useOptimisticMutation({
    mutationKey: mutationKeys.heroLibrary,
    mutationFn: (inHero: boolean) => api.setLibraryInHero({ id: library.id, inHero }),
    edits: (inHero) => librarySettingsEdits({ libraryId: library.id, change: { inHero } }),
    settle: () => afterHeroLibraries(queryClient),
  })
  return (
    <div className={styles.heroSetting}>
      <input
        id={id}
        type="checkbox"
        checked={library.settings.inHero}
        disabled={library.settings.locked}
        onChange={(event) => include.mutate(event.target.checked)}
      />
      <label
        htmlFor={id}
        title={
          library.settings.locked
            ? 'A locked library never shows in the hero'
            : "Let Home's hero show this library's movies and shows"
        }
      >
        Include in hero display<span className="visually-hidden"> for {library.name}</span>
      </label>
    </div>
  )
}

type LibraryRowProps = {
  library: Library
  isShut: boolean
  isOpen: boolean
  onToggle: () => void
}

/**
 * A library's card: its type icon in a well beside its name, its counts,
 * its folders grouped by the folder that holds them, how its scan stands,
 * and at its right Pin and the library page's own actions. The picture of
 * its newest video fades in at the card's right. While it is locked to
 * this browser it shows only its name, type and counts; the server sends no
 * more, and a list cached from before is held to the same. Its folders show
 * only while the admin lock is off.
 */
const LibraryRow = ({ library, isShut, isOpen, onToggle }: LibraryRowProps) => {
  const detailsId = useId()
  const actions = useLibraryActions(library)
  const backdrop = !isShut && library.backdrop && api.libraryBackdropUrl(library.backdrop)
  const lockNote = isShut ? ' · Locked' : ' · Unlocked'
  // The server sends no folders to a browser with the admin lock on; this holds a list cached from before to the same.
  const canManage = useCanManage()
  const paths = isShut || !canManage ? [] : library.paths

  return (
    <li className={styles.row}>
      {backdrop && (
        <span className={styles.backdrop} style={{ backgroundImage: `url("${backdrop}")` }} />
      )}
      <div className={isOpen ? styles.details : `${styles.details} ${styles.folded}`}>
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
        <Button
          icon="expand"
          tone="ghost"
          className={styles.toggle}
          aria-expanded={isOpen}
          aria-controls={detailsId}
          aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${library.name}`}
          title={isOpen ? 'Show less' : 'Show its folders, scan and actions'}
          onClick={onToggle}
        />
        {isOpen && (
          <div id={detailsId} className={styles.more}>
            {paths.length > 0 && (
              <ul className={styles.paths} aria-label="Folders">
                {foldersByParent(paths).map(({ parent, names }) => (
                  <li key={parent} className={styles.path}>
                    <span className={styles.parent}>{parent}</span>
                    <span className={styles.names}>{names.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.status}>
              <ScanStatus scan={library.scan} />
              <RatingsStatus refresh={library.ratingsRefresh} />
              <LibraryActionErrors actions={actions} className={styles.error} />
              <AdminOnly>
                <HeroCheckbox library={library} />
              </AdminOnly>
            </div>
            <div className={styles.actions}>
              <LibraryActions
                library={library}
                isShut={isShut}
                actions={actions}
                lead={<PinButton library={library} />}
              />
            </div>
          </div>
        )}
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
 * hold, with Add library at its right while the admin lock is off. A card
 * is folded to its name and counts until it is opened. The admin's Edit
 * order folds every card to a thin line to drag into place, or to move with
 * its buttons; Finish, or leaving the page, saves the order, and the cards
 * come back as they were opened. With none yet it says what a library is;
 * when the server does not answer it says so and offers to ask again.
 */
export const LibrariesPage = () => {
  const [adding, setAdding] = useState(false)
  const { mode, canManage } = useManagement()
  const libraries = useQuery({
    ...librariesQuery,
    // Poll while something scans (1.5 s) or a Refresh runs (5 s), so the counts
    // climb live, and read once when a waiting Refresh resumes.
    refetchInterval: (query) => libraryPollDelay({ libraries: query.state.data ?? [] }),
  })
  // The ones opened, kept while the cards are thin so they open again after.
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(new Set())
  const ordering = useLibraryOrdering({ libraries: libraries.data ?? [] })

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
        <BackButton fallback={HOME} className={styles.back} />
        <div className={styles.emptyBody}>
          <h1 className={styles.emptyTitle}>The server did not answer</h1>
          <p role="alert">{libraries.error.message}</p>
          <Button
            icon="reset"
            title="Ask the server for the libraries again"
            onClick={() => libraries.refetch()}
          >
            Try again
          </Button>
        </div>
      </section>
    )
  }

  if (libraries.data?.length === 0) {
    return (
      <section className={styles.empty}>
        <BackButton fallback={HOME} className={styles.back} />
        <div className={styles.emptyBody}>
          <h1 className={styles.emptyTitle}>Point raven at your videos</h1>
          <p>
            A library is a set of folders. Pick the ones that hold your movies or shows, and every
            video inside is indexed, given a thumbnail, and ready to play.
          </p>
          {canManage ? (
            <Button
              tone="primary"
              icon="plus"
              title="Add a library: a name, a type and the folders that hold its videos"
              onClick={() => setAdding(true)}
            >
              Add library
            </Button>
          ) : (
            <p>{cannotManageNote({ mode, action: 'add a library' })}</p>
          )}
          {dialog}
        </div>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <hgroup className={styles.heading}>
          <h1>Libraries</h1>
          {libraries.data && <p className={styles.summary}>{summaryOf(libraries.data)}</p>}
        </hgroup>
        <AdminOnly>
          <span className={styles.headerActions}>
            {(libraries.data?.length ?? 0) > 1 && (
              <Button
                tone={ordering.isEditing ? 'primary' : 'quiet'}
                icon={ordering.isEditing ? 'check' : 'edit'}
                title={
                  ordering.isEditing
                    ? 'Save the order and show the libraries in full again'
                    : 'Drag the libraries into the order they list in'
                }
                onClick={ordering.isEditing ? ordering.finish : ordering.start}
              >
                {ordering.isEditing ? 'Finish' : 'Edit order'}
              </Button>
            )}
            {!ordering.isEditing && (
              <Button
                tone="primary"
                icon="plus"
                title="Add a library: a name, a type and the folders that hold its videos"
                onClick={() => setAdding(true)}
              >
                Add library
              </Button>
            )}
          </span>
        </AdminOnly>
      </header>
      {ordering.failure && (
        <p role="alert" className={styles.failure}>
          {ordering.failure.message}
        </p>
      )}
      {libraries.isPending && <RowsSkeleton />}
      {!libraries.isPending && ordering.isEditing && <OrderedLibraries ordering={ordering} />}
      {!libraries.isPending && !ordering.isEditing && (
        <ul className={styles.list}>
          {ordering.ordered.map((library) => (
            <LibraryRow
              key={library.id}
              library={library}
              isOpen={openIds.has(library.id)}
              onToggle={() =>
                setOpenIds((current) =>
                  current.has(library.id)
                    ? new Set([...current].filter((id) => id !== library.id))
                    : new Set([...current, library.id]),
                )
              }
              isShut={
                lockState({ locked: library.settings.locked, lock: lock.data }).state !==
                LIBRARY_LOCK_STATES.open
              }
            />
          ))}
        </ul>
      )}
      {dialog}
    </section>
  )
}
