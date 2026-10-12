import { useQuery } from '@tanstack/react-query'
import { type Library, sagaBackdrop } from '@raven/core'
import { useId } from 'react'
import { useParams } from 'react-router-dom'
import { ItemHeader, ItemHeaderSkeleton } from '@/components/ItemHeader/ItemHeader'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { RouteState } from '@/components/RouteState/RouteState'
import { api } from '@/lib/api'
import { useLibraryLock } from '@/lib/libraryLock'
import { libraryQuery, sagasQuery } from '@/lib/queries'
import { routeState, useRouteId } from '@/lib/routeQuery'
import { sagaFacts, sagaRuntime } from '@/lib/sagas'
import { sectionPath } from '@/pages/LibraryPage/librarySections'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import styles from '@/pages/SagaPage/SagaPage.module.scss'

/** A saga on its way: its title and facts over a grid of posters. */
const SagaSkeleton = () => (
  <>
    <ItemHeaderSkeleton picture="none" />
    <MediaGridSkeleton posters count={6} />
  </>
)

/** The saga once its library is known and open to this browser. */
const SagaView = ({ library, sagaId }: { library: Library; sagaId: string }) => {
  const titleId = useId()
  const sagas = useQuery(sagasQuery(library.id))
  const page = routeState({
    id: library.id,
    query: {
      data: sagas.data && (sagas.data.find((saga) => saga.tmdbId === sagaId) ?? null),
      error: sagas.error,
    },
  })
  if (page.state !== 'ready')
    return <RouteState state={page} noun="saga" shape={<SagaSkeleton />} />
  if (page.data == null) return <NotFoundPage />
  const saga = page.data
  const runtime = sagaRuntime(saga)
  const backdrop = sagaBackdrop(saga)

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <ItemHeader
        back={{ to: sectionPath({ libraryId: library.id, section: 'sagas' }), label: 'Sagas' }}
        titleId={titleId}
        title={saga.name}
        byline={library.name}
        contentRating={null}
        facts={[...sagaFacts(saga), ...(runtime ? [runtime] : [])]}
        ratings={[]}
        backdrop={
          backdrop &&
          api.itemImageUrl({ id: backdrop.id, kind: 'backdrop', version: backdrop.version })
        }
      />
      <MediaGrid
        items={saga.media}
        posters
        matchType="movie"
        ratingsSource={library.settings.ratingsSource}
      />
    </section>
  )
}

/**
 * `/libraries/:id/sagas/:sagaId`: one saga, under its backdrop, with its
 * movies oldest first, to pick the one to watch. A saga in a library still
 * locked to this browser waits for the PIN, as the library's page does.
 */
export const SagaPage = () => {
  const libraryId = useRouteId()
  const sagaId = useParams().sagaId ?? ''
  const library = useQuery(libraryQuery(libraryId))
  const lock = useLibraryLock(library.data)
  const page = routeState({ id: libraryId, query: library })
  if (page.state !== 'ready')
    return <RouteState state={page} noun="saga" shape={<SagaSkeleton />} />
  switch (lock.state) {
    case 'checking':
      return null
    case 'shut':
      return <LockedLibrary name={page.data.name} available={lock.available} />
    case 'open':
      return <SagaView library={page.data} sagaId={sagaId} />
    default: {
      const unknown: never = lock
      return unknown
    }
  }
}
