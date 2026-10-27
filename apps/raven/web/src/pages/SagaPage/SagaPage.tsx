import { useQuery } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  type Library,
  ROUTE_STATES,
  SAGA_BACKDROP_TYPES,
  type Saga,
  routeState,
  sagaCover,
  sagaFacts,
  sagaPictures,
  sagaRuntime,
  sagaTargets,
  watchLink,
  watchedStateOf,
} from '@raven/core'
import { type ReactNode, useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, ButtonLink } from '@raven/ui'
import {
  type HeaderBackdrop,
  itemBackdrop,
  ItemHeader,
  ItemHeaderSkeleton,
} from '@/components/ItemHeader/ItemHeader'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { RouteState } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import { SelectionScope, mediaEntryOf, sourceOf } from '@/components/SelectionScope/SelectionScope'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'
import { api } from '@/lib/api'
import { LIBRARY_LOCK_STATES, useLibraryLock } from '@/lib/libraryLock'
import { libraryQuery, sagasQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { useWatchedToggle } from '@/lib/useWatchedChange'
import { useOwnBackdrop } from '@/lib/useHoverBackdrop'
import { sectionPath } from '@/pages/LibraryPage/librarySections'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { SagaBackdropDialog } from '@/pages/SagaPage/SagaBackdropDialog'
import { SagaFilms } from '@/pages/SagaPage/SagaFilms'
import styles from '@/pages/SagaPage/SagaPage.module.scss'

/** A saga on its way: its title and facts over stand-ins for its movies. */
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
    case SAGA_BACKDROP_TYPES.slideshow: {
      const slides = sagaPictures(saga).map((picture) => api.sagaPictureUrl(picture))
      return slides.length === 0 ? null : { type: 'slideshow', slides, motion: backdrop.motion }
    }
    case SAGA_BACKDROP_TYPES.still: {
      const cover = sagaCover(saga)
      return cover && itemBackdrop({ id: cover.id, version: cover.version })
    }
    default: {
      const unknown: never = backdrop
      return unknown
    }
  }
}

type SagaWatchedToggleProps = { saga: Saga; libraryId: number }

/** Watched for the whole saga: its movies are marked together. */
const SagaWatchedToggle = ({ saga, libraryId }: SagaWatchedToggleProps) => {
  const toggle = useWatchedToggle({
    state: watchedStateOf({
      watched: saga.media.filter((media) => media.watched).length,
      total: saga.media.length,
    }),
    targets: sagaTargets({ saga, libraryId }),
  })
  return <WatchedToggle {...toggle} />
}

type OwnBackdropProps = { children: ReactNode }

/** The saga has a backdrop of its own, which pointing at a movie leaves up. */
const OwnBackdrop = ({ children }: OwnBackdropProps) => {
  const isOwn = useOwnBackdrop()
  return isOwn && children
}

type SagaViewProps = { library: Library; sagaId: string }

/** The saga once its library is known and open to this browser. */
const SagaView = ({ library, sagaId }: SagaViewProps) => {
  const titleId = useId()
  const filmsId = useId()
  const [isEditing, setEditing] = useState(false)
  const sagas = useQuery(sagasQuery(library.id))
  const page = routeState({
    id: library.id,
    query: {
      data: sagas.data && (sagas.data.find((saga) => saga.tmdbId === sagaId) ?? null),
      error: sagas.error,
    },
  })
  if (page.state !== ROUTE_STATES.ready)
    return <RouteState state={page} noun="saga" shape={<SagaSkeleton />} />
  if (page.data == null) return <NotFoundPage />
  const saga = page.data
  const runtime = sagaRuntime(saga)
  const [count, ...span] = sagaFacts(saga)
  const watchedCount = saga.media.filter((media) => media.watched).length
  const backdrop = headerBackdrop(saga)
  const [first, ...rest] = saga.media

  return (
    <OwnBackdrop>
      <SelectionScope {...sourceOf(saga.media.map(mediaEntryOf))}>
        <section className={styles.page} aria-labelledby={titleId}>
          <ItemHeader
            back={{ to: sectionPath({ libraryId: library.id, section: 'sagas' }), label: 'Sagas' }}
            titleId={titleId}
            eyebrow={['Saga', count].filter((part): part is string => part != null)}
            title={saga.name}
            byline={library.name}
            contentRating={null}
            facts={[...span, ...(runtime ? [runtime] : [])]}
            ratings={[]}
            progress={
              saga.media.length > 0
                ? {
                    fraction: watchedCount / saga.media.length,
                    label: `${watchedCount} of ${saga.media.length} watched`,
                  }
                : undefined
            }
            backdrop={backdrop}
            manage={
              backdrop && (
                <AdminOnly>
                  <Button icon="edit" onClick={() => setEditing(true)}>
                    Edit backdrop
                  </Button>
                </AdminOnly>
              )
            }
          >
            {first && (
              <ButtonLink tone="primary" icon="play" {...watchLink({ media: first, upNext: rest })}>
                Play all
              </ButtonLink>
            )}
            <DownloadButton
              target={{
                kind: DOWNLOAD_TARGET_KINDS.saga,
                libraryId: library.id,
                tmdbId: saga.tmdbId,
              }}
            />
            {first && <SagaWatchedToggle saga={saga} libraryId={library.id} />}
            <SelectButton />
          </ItemHeader>
          <section className={styles.films} aria-labelledby={filmsId}>
            <SectionHeading id={filmsId} aside="Release order">
              In order
            </SectionHeading>
            <SagaFilms media={saga.media} ratingsSource={library.settings.ratingsSource} />
          </section>
          <AdminOnly>
            {isEditing && (
              <SagaBackdropDialog
                libraryId={library.id}
                saga={saga}
                onClose={() => setEditing(false)}
              />
            )}
          </AdminOnly>
          <SelectionBar />
        </section>
      </SelectionScope>
    </OwnBackdrop>
  )
}

/**
 * `/libraries/:id/sagas/:sagaId`: one saga, under its movies' backdrops in
 * turn or the one it holds still, with how many of them are watched and
 * Play all, which plays its movies one after another, then its movies
 * numbered in release order, each saying whether it is watched or up next,
 * to pick one to watch. A saga in a library still locked to this browser
 * waits for the PIN, as the library's page does.
 */
export const SagaPage = () => {
  const libraryId = useRouteId()
  const sagaId = useParams().sagaId ?? ''
  const library = useQuery(libraryQuery(libraryId))
  const lock = useLibraryLock(library.data)
  const page = routeState({ id: libraryId, query: library })
  if (page.state !== ROUTE_STATES.ready)
    return <RouteState state={page} noun="saga" shape={<SagaSkeleton />} />
  switch (lock.state) {
    case LIBRARY_LOCK_STATES.checking:
      return null
    case LIBRARY_LOCK_STATES.shut:
      return <LockedLibrary name={page.data.name} available={lock.available} />
    case LIBRARY_LOCK_STATES.open:
      return <SagaView library={page.data} sagaId={sagaId} />
    default: {
      const unknown: never = lock
      return unknown
    }
  }
}
