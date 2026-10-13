import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type Library, isScanning } from '@raven/core'
import { useId } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ButtonLink } from '@/components/Button/Button'
import { useLibraryActions } from '@/components/LibraryActions/LibraryActions'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { RouteState } from '@/components/RouteState/RouteState'
import { Bone } from '@/components/Skeleton/Skeleton'
import { useLibraryLock } from '@/lib/libraryLock'
import { librariesQuery, libraryQuery } from '@/lib/queries'
import { routeState, useRouteId } from '@/lib/routeQuery'
import { LibraryHeader } from '@/pages/LibraryPage/LibraryHeader'
import { LibraryTabs } from '@/pages/LibraryPage/LibraryTabs'
import { SectionView } from '@/pages/LibraryPage/SectionViews'
import {
  type LibrarySection,
  SECTIONS,
  hasSection,
  sectionFrom,
  sectionPath,
} from '@/pages/LibraryPage/librarySections'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** The page once its library is known, open at one of its tabs. */
const LibraryView = ({ library, section }: { library: Library; section: LibrarySection }) => {
  const titleId = useId()
  // A locked library's videos are not asked for until this browser has the PIN.
  const lock = useLibraryLock(library)
  const isShut = lock.state !== 'open'
  const actions = useLibraryActions(library)

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <ButtonLink to="/libraries" icon="back" className={styles.back}>
        Libraries
      </ButtonLink>

      <LibraryHeader titleId={titleId} library={library} actions={actions} isShut={isShut} />

      {lock.state === 'shut' && <LockedLibrary name={library.name} available={lock.available} />}

      {!isShut && (
        <>
          <LibraryTabs library={library} current={section} />

          {actions.rematch.isError && (
            <p className={styles.message} role="alert">
              Could not match again: {actions.rematch.error.message}
            </p>
          )}

          {/* Keyed by its tab, so moving to another starts its body afresh. */}
          <section key={section} className={styles.section} aria-label={SECTIONS[section].label}>
            <SectionView library={library} section={section} />
          </section>
        </>
      )}
    </section>
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
  const section = sectionFrom(useParams().section)
  const library = useQuery({
    ...libraryQuery(libraryId),
    placeholderData: () =>
      queryClient.getQueryData(librariesQuery.queryKey)?.find((entry) => entry.id === libraryId),
    refetchInterval: (current) =>
      current.state.data && isScanning(current.state.data.scan) ? 1500 : false,
  })
  const page = routeState({ id: libraryId, query: library })
  if (section == null) return <NotFoundPage />
  if (page.state !== 'ready') {
    return <RouteState state={page} noun="library" shape={<LibrarySkeleton />} />
  }
  if (!hasSection({ kind: page.data.settings.kind, section })) {
    return <Navigate to={sectionPath({ libraryId: page.data.id, section: 'all' })} replace />
  }
  return <LibraryView library={page.data} section={section} />
}
