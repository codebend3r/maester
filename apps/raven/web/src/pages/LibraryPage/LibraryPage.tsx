import { useQuery } from '@tanstack/react-query'
import { type Library, isScanning } from '@raven/core'
import { useId, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ButtonLink } from '@/components/Button/Button'
import { LibraryDialog } from '@/components/LibraryDialog/LibraryDialog'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { RouteState } from '@/components/RouteState/RouteState'
import { useLibraryLock } from '@/lib/libraryLock'
import { libraryQuery } from '@/lib/queries'
import { routeState, useRouteId } from '@/lib/routeQuery'
import { LibraryHeader, useLibraryActions } from '@/pages/LibraryPage/LibraryHeader'
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
import { useUnlockPrompt } from '@/stores/unlockPrompt'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** The page once its library is known, open at one of its tabs. */
const LibraryView = ({ library, section }: { library: Library; section: LibrarySection }) => {
  const titleId = useId()
  const [isEditing, setEditing] = useState(false)
  // A locked library's videos are not asked for until this browser has the PIN.
  const lock = useLibraryLock(library)
  const isShut = lock.state !== 'open'
  const actions = useLibraryActions(library)

  // A locked library's folders stay on the server until the PIN is entered,
  // so Edit asks for it rather than open with none.
  const edit = () => {
    if (isShut) return useUnlockPrompt.getState().ask()
    setEditing(true)
  }

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <ButtonLink to="/libraries" icon="back" className={styles.back}>
        Libraries
      </ButtonLink>

      <LibraryHeader
        titleId={titleId}
        library={library}
        actions={actions}
        isShut={isShut}
        onEdit={edit}
      />

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

      {isEditing && <LibraryDialog library={library} onClose={() => setEditing(false)} />}
    </section>
  )
}

/**
 * `/libraries/:id`: a library's videos or shows, searched, sorted and laid
 * out as it was left, with its other tabs at `/libraries/:id/:section`. A
 * tab the library's type does not have, as after a change of type, opens All.
 */
export const LibraryPage = () => {
  const libraryId = useRouteId()
  const section = sectionFrom(useParams().section)
  const library = useQuery({
    ...libraryQuery(libraryId),
    refetchInterval: (current) =>
      current.state.data && isScanning(current.state.data.scan) ? 1500 : false,
  })
  const page = routeState({ id: libraryId, query: library })
  if (section == null) return <NotFoundPage />
  if (page.state !== 'ready') return <RouteState state={page} noun="library" />
  if (!hasSection({ kind: page.data.settings.kind, section })) {
    return <Navigate to={sectionPath({ libraryId: page.data.id, section: 'all' })} replace />
  }
  return <LibraryView library={page.data} section={section} />
}
