import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type Library, ROUTE_STATES, type RouteQuery, routeState } from '@raven/core'
import { useId } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { LibraryActionErrors, useLibraryActions } from '@/components/LibraryActions/LibraryActions'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { RouteState } from '@/components/RouteState/RouteState'
import { Bone } from '@/components/Skeleton/Skeleton'
import { libraryPollDelay } from '@/lib/libraryPolling'
import { LIBRARY_LOCK_STATES, useLibraryLock } from '@/lib/libraryLock'
import { librariesQuery, libraryQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import { LibraryHeader } from '@/pages/LibraryPage/LibraryHeader'
import { LibraryTabs } from '@/pages/LibraryPage/LibraryTabs'
import { SectionView } from '@/pages/LibraryPage/SectionViews'
import {
  type LibrarySection,
  SECTIONS,
  hasSection,
  openingSection,
  sectionFrom,
  sectionPath,
} from '@/pages/LibraryPage/librarySections'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

const LIBRARY_VIEW_KEYS = { missing: 'missing', elsewhere: 'elsewhere', open: 'open' } as const

type OpenLibraryProps = {
  library: Library
  section: LibrarySection
  titleId: string
  lock: ReturnType<typeof useLibraryLock>
  actions: ReturnType<typeof useLibraryActions>
}

/** The library open at one of its tabs. */
const OpenLibrary = ({ library, section, titleId, lock, actions }: OpenLibraryProps) => {
  const isShut = lock.state !== LIBRARY_LOCK_STATES.open
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <LibraryHeader titleId={titleId} library={library} actions={actions} isShut={isShut} />

      {lock.state === LIBRARY_LOCK_STATES.shut && <LockedLibrary name={library.name} />}

      {!isShut && (
        <>
          <LibraryTabs library={library} current={section} />

          <LibraryActionErrors actions={actions} className={styles.message} />

          {/* Keyed by its tab, so moving to another starts its body afresh. */}
          <section key={section} className={styles.section} aria-label={SECTIONS[section].label}>
            <SectionView library={library} section={section} />
          </section>
        </>
      )}
    </section>
  )
}

type ToSectionProps = { to: string }

/** Away from a tab the library's type does not have. */
const ToSection = ({ to }: ToSectionProps) => <Navigate to={to} replace />

type LibraryViewsProps = {
  [LIBRARY_VIEW_KEYS.missing]: Record<never, never>
  [LIBRARY_VIEW_KEYS.elsewhere]: ToSectionProps
  [LIBRARY_VIEW_KEYS.open]: OpenLibraryProps
}

const LIBRARY_VIEWS = {
  [LIBRARY_VIEW_KEYS.missing]: NotFoundPage,
  [LIBRARY_VIEW_KEYS.elsewhere]: ToSection,
  [LIBRARY_VIEW_KEYS.open]: OpenLibrary,
} as const satisfies ViewsOf<LibraryViewsProps>

type LibraryViewOfProps = Omit<OpenLibraryProps, 'section'> & { section: LibrarySection | null }

/** Which view the library shows: no such tab, a tab its type has not, or the tab. */
const libraryViewOf = ({
  library,
  section,
  ...rest
}: LibraryViewOfProps): ViewOf<LibraryViewsProps> => {
  if (section == null) return { key: LIBRARY_VIEW_KEYS.missing, props: {} }
  const { kind } = library.settings
  if (!hasSection({ kind, section }))
    return {
      key: LIBRARY_VIEW_KEYS.elsewhere,
      props: { to: sectionPath({ libraryId: library.id, section: openingSection(kind) }) },
    }
  return { key: LIBRARY_VIEW_KEYS.open, props: { library, section, ...rest } }
}

type LibraryViewProps = { library: Library; param: string | undefined }

/** The page once its library is known, open at one of its tabs. */
const LibraryView = ({ library, param }: LibraryViewProps) => {
  const titleId = useId()
  const section = sectionFrom({ param, kind: library.settings.kind })
  // A locked library's videos are not asked for until this browser has the PIN.
  const lock = useLibraryLock(library)
  const actions = useLibraryActions(library)
  return (
    <KeyedView<LibraryViewsProps>
      views={LIBRARY_VIEWS}
      view={libraryViewOf({ library, section, titleId, lock, actions })}
    />
  )
}

/** The page before anything of its library is known: the way back, its title and counts, its tabs, and a grid of cards. */
const LibrarySkeleton = () => (
  <>
    <Bone shape="button" />
    <Bone shape="hero" width="half" />
    <Bone shape="text" width="short" />
    <Bone shape="text" width="most" />
    <MediaGridSkeleton />
  </>
)

const LIBRARY_PAGE_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type LibraryPageViewsProps = {
  [LIBRARY_PAGE_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [LIBRARY_PAGE_VIEW_KEYS.ready]: LibraryViewProps
}

const LIBRARY_PAGE_VIEWS = {
  [LIBRARY_PAGE_VIEW_KEYS.pending]: RouteState,
  [LIBRARY_PAGE_VIEW_KEYS.ready]: LibraryView,
} as const satisfies ViewsOf<LibraryPageViewsProps>

type LibraryPageViewProps = { page: RouteQuery<Library>; param: string | undefined }

/** Which view the page shows: its library on its way or failing, or the library. */
const libraryPageView = ({ page, param }: LibraryPageViewProps): ViewOf<LibraryPageViewsProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: LIBRARY_PAGE_VIEW_KEYS.pending,
      props: { state: page, noun: LIBRARY_COPY.noun, shape: <LibrarySkeleton /> },
    }
  return { key: LIBRARY_PAGE_VIEW_KEYS.ready, props: { library: page.data, param } }
}

/**
 * `/libraries/:id`: a library's videos or shows, searched, sorted and laid
 * out as it was left, with its other tabs at `/libraries/:id/:section`. A
 * tab the library's type does not have, as after a change of type, opens All.
 * The libraries list the side menu reads already holds this one, so the
 * page opens on that while the library itself is read.
 */
export const LibraryPage = () => {
  const queryClient = useQueryClient()
  const libraryId = useRouteId()
  const param = useParams().section
  const library = useQuery({
    ...libraryQuery(libraryId),
    placeholderData: () =>
      queryClient.getQueryData(librariesQuery.queryKey)?.find((entry) => entry.id === libraryId),
    refetchInterval: (current) =>
      libraryPollDelay({ libraries: current.state.data ? [current.state.data] : [] }),
  })
  const page = routeState({ id: libraryId, query: library })
  return (
    <KeyedView<LibraryPageViewsProps>
      views={LIBRARY_PAGE_VIEWS}
      view={libraryPageView({ page, param })}
    />
  )
}
