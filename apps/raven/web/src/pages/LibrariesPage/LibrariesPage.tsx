import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KINDS, type Library } from '@raven/core'
import { type ComponentType, type ReactNode, useId, useState } from 'react'
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
import {
  type ManagementMode,
  cannotManageNote,
  useCanManage,
  useManagement,
} from '@/lib/management'
import { api } from '@/lib/api'
import {
  afterHeroLibraries,
  afterPins,
  librarySettingsEdits,
  mutationKeys,
  useOptimisticMutation,
  KeyedView,
  type ViewOf,
  type ViewsOf,
} from '@raven/ui/headless'
import { foldersByParent } from '@/lib/folders'
import { libraryPollDelay } from '@/lib/libraryPolling'
import { LIBRARY_LOCK_STATES, lockState } from '@/lib/libraryLock'
import { useLibraryOrdering } from '@/lib/useLibraryOrdering'
import { librariesQuery, lockQuery } from '@/lib/queries'
import { LIBRARIES_COPY } from '@/pages/LibrariesPage/copy'
import { OrderedLibraries } from '@/pages/LibrariesPage/OrderedLibraries'
import styles from '@/pages/LibrariesPage/LibrariesPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'

/** How many libraries there are and how many videos they hold between them. */
const summaryOf = (libraries: readonly Library[]): string =>
  [
    LIBRARIES_COPY.libraries(libraries.length),
    COMMON_COPY.videos(libraries.reduce((sum, library) => sum + library.itemCount, 0)),
  ].join(COMMON_COPY.separator)

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
      title={pinned ? LIBRARIES_COPY.pinnedTitle : LIBRARIES_COPY.pinTitle}
      onClick={() => pin.mutate(!pinned)}
    >
      <span aria-hidden="true">{pinned ? LIBRARIES_COPY.pinned : LIBRARIES_COPY.pin}</span>
      <span className="visually-hidden">{LIBRARIES_COPY.pinName(library.name)}</span>
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
        title={library.settings.locked ? LIBRARIES_COPY.heroLockedTitle : LIBRARIES_COPY.heroTitle}
      >
        {LIBRARIES_COPY.includeInHero}
        <span className="visually-hidden">{LIBRARIES_COPY.heroFor(library.name)}</span>
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
  const lockNote = isShut ? LIBRARIES_COPY.locked : LIBRARIES_COPY.unlocked
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
          {library.settings.locked && lockNote}
          {COMMON_COPY.separator}
          {COMMON_COPY.videos(library.itemCount)}
          {library.unmatchedCount > 0 && LIBRARIES_COPY.notMatched(library.unmatchedCount)}
        </span>
        <Button
          icon="expand"
          tone="ghost"
          className={styles.toggle}
          aria-expanded={isOpen}
          aria-controls={detailsId}
          aria-label={
            isOpen ? LIBRARIES_COPY.collapse(library.name) : LIBRARIES_COPY.expand(library.name)
          }
          title={isOpen ? LIBRARIES_COPY.showLess : LIBRARIES_COPY.showMore}
          onClick={onToggle}
        />
        {isOpen && (
          <div id={detailsId} className={styles.more}>
            {paths.length > 0 && (
              <ul className={styles.paths} aria-label={LIBRARIES_COPY.folders}>
                {foldersByParent(paths).map(({ parent, names }) => (
                  <li key={parent} className={styles.path}>
                    <span className={styles.parent}>{parent}</span>
                    <span className={styles.names}>{names.join(COMMON_COPY.separator)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.status}>
              <ScanStatus scan={library.scan} expected={library.itemCount} />
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
  <Loading label={LIBRARIES_COPY.gathering}>
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

type AddLibraryButtonProps = { onAdd: () => void }

const AddLibraryButton = ({ onAdd }: AddLibraryButtonProps) => (
  <Button tone="primary" icon="plus" title={LIBRARIES_COPY.addTitle} onClick={onAdd}>
    {COMMON_COPY.addLibrary}
  </Button>
)

type AddLibraryProps = AddLibraryButtonProps & { mode: ManagementMode }

type CannotAddNoteProps = AddLibraryProps

const CannotAddNote = ({ mode }: CannotAddNoteProps) => (
  <p>{cannotManageNote({ mode, action: LIBRARIES_COPY.addAction })}</p>
)

const ADD_KEYS = { can: 'can', cannot: 'cannot' } as const

type AddKey = (typeof ADD_KEYS)[keyof typeof ADD_KEYS]

/** Add library for one who may manage, else why not. */
const ADD_VIEWS = {
  [ADD_KEYS.can]: AddLibraryButton,
  [ADD_KEYS.cannot]: CannotAddNote,
} as const satisfies Record<AddKey, ComponentType<AddLibraryProps>>

type LibrariesFailedProps = { message: string; onRetry: () => void }

const LibrariesFailed = ({ message, onRetry }: LibrariesFailedProps) => (
  <section className={styles.empty}>
    <BackButton fallback={HOME} className={styles.back} />
    <div className={styles.emptyBody}>
      <h1 className={styles.emptyTitle}>{LIBRARIES_COPY.noAnswer}</h1>
      <p role="alert">{message}</p>
      <Button icon="reset" title={LIBRARIES_COPY.askAgain} onClick={onRetry}>
        {LIBRARIES_COPY.tryAgain}
      </Button>
    </div>
  </section>
)

type LibrariesEmptyProps = AddLibraryProps & { canManage: boolean; dialog: ReactNode }

const LibrariesEmpty = ({ canManage, mode, onAdd, dialog }: LibrariesEmptyProps) => {
  const Add = ADD_VIEWS[canManage ? ADD_KEYS.can : ADD_KEYS.cannot]
  return (
    <section className={styles.empty}>
      <BackButton fallback={HOME} className={styles.back} />
      <div className={styles.emptyBody}>
        <h1 className={styles.emptyTitle}>{LIBRARIES_COPY.emptyTitle}</h1>
        <p>{LIBRARIES_COPY.emptyBody}</p>
        <Add mode={mode} onAdd={onAdd} />
        {dialog}
      </div>
    </section>
  )
}

type Ordering = ReturnType<typeof useLibraryOrdering>

type LibraryCardsProps = {
  ordering: Ordering
  openIds: ReadonlySet<number>
  onToggle: (id: number) => void
  isShut: (library: Library) => boolean
}

const LibraryCards = ({ ordering, openIds, onToggle, isShut }: LibraryCardsProps) => (
  <ul className={styles.list}>
    {ordering.ordered.map((library) => (
      <LibraryRow
        key={library.id}
        library={library}
        isOpen={openIds.has(library.id)}
        onToggle={() => onToggle(library.id)}
        isShut={isShut(library)}
      />
    ))}
  </ul>
)

const LIST_KEYS = { pending: 'pending', ordering: 'ordering', cards: 'cards' } as const

type ListProps = {
  [LIST_KEYS.pending]: Record<never, never>
  [LIST_KEYS.ordering]: Parameters<typeof OrderedLibraries>[0]
  [LIST_KEYS.cards]: LibraryCardsProps
}

/** The cards on their way, thin while their order is edited, else in full. */
const LIST_VIEWS = {
  [LIST_KEYS.pending]: RowsSkeleton,
  [LIST_KEYS.ordering]: OrderedLibraries,
  [LIST_KEYS.cards]: LibraryCards,
} as const satisfies ViewsOf<ListProps>

type ListViewOfProps = LibraryCardsProps & { isPending: boolean }

const listViewOf = ({ isPending, ...cards }: ListViewOfProps): ViewOf<ListProps> => {
  if (isPending) return { key: LIST_KEYS.pending, props: {} }
  if (cards.ordering.isEditing)
    return { key: LIST_KEYS.ordering, props: { ordering: cards.ordering } }
  return { key: LIST_KEYS.cards, props: cards }
}

type LibrariesListedProps = ListViewOfProps & {
  libraries: readonly Library[] | undefined
  onAdd: () => void
  dialog: ReactNode
}

const LibrariesListed = ({ libraries, onAdd, dialog, ...list }: LibrariesListedProps) => {
  const { ordering } = list
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <hgroup className={styles.heading}>
          <PageTitle icon="libraries">{COMMON_COPY.libraries}</PageTitle>
          {libraries && <p className={styles.summary}>{summaryOf(libraries)}</p>}
        </hgroup>
        <AdminOnly>
          <span className={styles.headerActions}>
            {(libraries?.length ?? 0) > 1 && (
              <Button
                tone={ordering.isEditing ? 'primary' : 'quiet'}
                icon={ordering.isEditing ? 'check' : 'edit'}
                title={
                  ordering.isEditing ? LIBRARIES_COPY.saveOrderTitle : LIBRARIES_COPY.editOrderTitle
                }
                onClick={ordering.isEditing ? ordering.finish : ordering.start}
              >
                {ordering.isEditing ? LIBRARIES_COPY.finish : LIBRARIES_COPY.editOrder}
              </Button>
            )}
            {!ordering.isEditing && <AddLibraryButton onAdd={onAdd} />}
          </span>
        </AdminOnly>
      </header>
      {ordering.failure && (
        <p role="alert" className={styles.failure}>
          {ordering.failure.message}
        </p>
      )}
      <KeyedView<ListProps> views={LIST_VIEWS} view={listViewOf(list)} />
      {dialog}
    </section>
  )
}

const LIBRARIES_VIEW_KEYS = { failed: 'failed', empty: 'empty', listed: 'listed' } as const

type LibrariesViewProps = {
  [LIBRARIES_VIEW_KEYS.failed]: LibrariesFailedProps
  [LIBRARIES_VIEW_KEYS.empty]: LibrariesEmptyProps
  [LIBRARIES_VIEW_KEYS.listed]: LibrariesListedProps
}

const LIBRARIES_VIEWS = {
  [LIBRARIES_VIEW_KEYS.failed]: LibrariesFailed,
  [LIBRARIES_VIEW_KEYS.empty]: LibrariesEmpty,
  [LIBRARIES_VIEW_KEYS.listed]: LibrariesListed,
} as const satisfies ViewsOf<LibrariesViewProps>

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
  const onAdd = () => setAdding(true)
  const view = ((): ViewOf<LibrariesViewProps> => {
    if (libraries.isError)
      return {
        key: LIBRARIES_VIEW_KEYS.failed,
        props: { message: libraries.error.message, onRetry: () => libraries.refetch() },
      }
    if (libraries.data?.length === 0)
      return { key: LIBRARIES_VIEW_KEYS.empty, props: { canManage, mode, onAdd, dialog } }
    return {
      key: LIBRARIES_VIEW_KEYS.listed,
      props: {
        libraries: libraries.data,
        isPending: libraries.isPending,
        ordering,
        openIds,
        onToggle: (id) =>
          setOpenIds((current) =>
            current.has(id)
              ? new Set([...current].filter((open) => open !== id))
              : new Set([...current, id]),
          ),
        isShut: (library) =>
          lockState({ locked: library.settings.locked, lock: lock.data }).state !==
          LIBRARY_LOCK_STATES.open,
        onAdd,
        dialog,
      },
    }
  })()

  return <KeyedView<LibrariesViewProps> views={LIBRARIES_VIEWS} view={view} />
}
