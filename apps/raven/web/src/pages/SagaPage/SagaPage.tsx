import { useQuery } from '@tanstack/react-query'
import { type Library, type Saga, sagaCover, sagaPictures } from '@raven/core'
import { useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, ButtonLink } from '@raven/ui'
import {
  type HeaderBackdrop,
  ItemHeader,
  ItemHeaderSkeleton,
} from '@/components/ItemHeader/ItemHeader'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { RouteState } from '@/components/RouteState/RouteState'
import { api } from '@/lib/api'
import { watchLink } from '@/lib/itemLinks'
import { useLibraryLock } from '@/lib/libraryLock'
import { libraryQuery, sagasQuery } from '@/lib/queries'
import { routeState, useRouteId } from '@/lib/routeQuery'
import { sagaFacts, sagaRuntime } from '@/lib/sagas'
import { HoverBackdrops } from '@/lib/useHoverBackdrop'
import { sectionPath } from '@/pages/LibraryPage/librarySections'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { SagaBackdropDialog } from '@/pages/SagaPage/SagaBackdropDialog'
import styles from '@/pages/SagaPage/SagaPage.module.scss'

/** A saga on its way: its title and facts over a grid of posters. */
const SagaSkeleton = () => (
  <>
    <ItemHeaderSkeleton picture="none" />
    <MediaGridSkeleton posters count={6} />
  </>
)

/**
 * What the saga shows behind its title, as its library picked: its movies'
 * backdrops in turn, or its cover held still; null when none has one.
 */
const headerBackdrop = (saga: Saga): HeaderBackdrop | null => {
  const { backdrop } = saga
  switch (backdrop.type) {
    case 'slideshow': {
      const slides = sagaPictures(saga).map((picture) => api.sagaPictureUrl(picture))
      return slides.length === 0 ? null : { type: 'slideshow', slides, motion: backdrop.motion }
    }
    case 'still': {
      const cover = sagaCover(saga)
      return cover && { type: 'picture', url: api.sagaPictureUrl(cover) }
    }
    default: {
      const unknown: never = backdrop
      return unknown
    }
  }
}

/** The saga once its library is known and open to this browser. */
const SagaView = ({ library, sagaId }: { library: Library; sagaId: string }) => {
  const titleId = useId()
  const [isEditing, setEditing] = useState(false)
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
  const backdrop = headerBackdrop(saga)
  const [first, ...rest] = saga.media

  return (
    // The saga has a backdrop of its own, which pointing at a movie leaves up.
    <HoverBackdrops value={false}>
      <section className={styles.page} aria-labelledby={titleId}>
        <ItemHeader
          back={{ to: sectionPath({ libraryId: library.id, section: 'sagas' }), label: 'Sagas' }}
          titleId={titleId}
          title={saga.name}
          byline={library.name}
          contentRating={null}
          facts={[...sagaFacts(saga), ...(runtime ? [runtime] : [])]}
          ratings={[]}
          backdrop={backdrop}
        >
          {first && (
            <ButtonLink
              tone="primary"
              size="large"
              icon="play"
              {...watchLink({ media: first, upNext: rest })}
            >
              Play all
            </ButtonLink>
          )}
          {backdrop && (
            <AdminOnly>
              <Button icon="edit" onClick={() => setEditing(true)}>
                Edit backdrop
              </Button>
              {isEditing && (
                <SagaBackdropDialog
                  libraryId={library.id}
                  saga={saga}
                  onClose={() => setEditing(false)}
                />
              )}
            </AdminOnly>
          )}
        </ItemHeader>
        <MediaGrid
          items={saga.media}
          posters
          matchType="movie"
          ratingsSource={library.settings.ratingsSource}
        />
      </section>
    </HoverBackdrops>
  )
}

/**
 * `/libraries/:id/sagas/:sagaId`: one saga, under its movies' backdrops in
 * turn or the one it holds still, with Play all, which plays its movies one
 * after another, and its movies oldest first, to pick one to watch. A saga
 * in a library still locked to this browser waits for the PIN, as the
 * library's page does.
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
