import { useQuery } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  type Library,
  ROUTE_STATES,
  type RouteQuery,
  SAGA_BACKDROP_TYPES,
  SESSION_KINDS,
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
import { useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, ButtonLink } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
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
import { LIBRARY_LOCK_STATES, type LibraryLock, useLibraryLock } from '@/lib/libraryLock'
import { libraryQuery, sagasQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { useWatchedToggle } from '@/lib/useWatchedChange'
import { LIBRARY_SECTIONS, sectionPath } from '@/pages/LibraryPage/librarySections'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'
import { SagaBackdropDialog } from '@/pages/SagaPage/SagaBackdropDialog'
import { SagaFilms } from '@/pages/SagaPage/SagaFilms'
import { SAGA_COPY } from '@/pages/SagaPage/copy'
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

type ShownSagaProps = { library: Library; saga: Saga }

/** The saga, found in its library. */
const ShownSaga = ({ library, saga }: ShownSagaProps) => {
  const titleId = useId()
  const filmsId = useId()
  const [isEditing, setEditing] = useState(false)
  const runtime = sagaRuntime(saga)
  const [count, ...span] = sagaFacts(saga)
  const watchedCount = saga.media.filter((media) => media.watched).length
  const backdrop = headerBackdrop(saga)
  const [first] = saga.media

  return (
    <SelectionScope {...sourceOf(saga.media.map(mediaEntryOf))}>
      <section className={styles.page} aria-labelledby={titleId}>
        <ItemHeader
          back={{
            to: sectionPath({ libraryId: library.id, section: LIBRARY_SECTIONS.sagas }),
            label: SAGA_COPY.sagas,
          }}
          titleId={titleId}
          eyebrow={[SAGA_COPY.saga, count].filter((part): part is string => part != null)}
          title={saga.name}
          byline={library.name}
          contentRating={null}
          facts={[...span, ...(runtime ? [runtime] : [])]}
          ratings={[]}
          progress={
            saga.media.length > 0
              ? {
                  fraction: watchedCount / saga.media.length,
                  label: SAGA_COPY.watchedOf({ watched: watchedCount, total: saga.media.length }),
                }
              : undefined
          }
          backdrop={backdrop}
          manage={
            backdrop && (
              <AdminOnly>
                <Button icon="edit" onClick={() => setEditing(true)}>
                  {SAGA_COPY.editBackdrop}
                </Button>
              </AdminOnly>
            )
          }
        >
          {first && (
            <ButtonLink
              tone="primary"
              icon="play"
              {...watchLink({
                media: first,
                session: { kind: SESSION_KINDS.saga, sagaId: saga.tmdbId },
              })}
            >
              {SAGA_COPY.playAll}
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
          <SectionHeading id={filmsId} aside={SAGA_COPY.releaseOrder}>
            {SAGA_COPY.inOrder}
          </SectionHeading>
          <SagaFilms
            media={saga.media}
            sagaId={saga.tmdbId}
            ratingsSource={library.settings.ratingsSource}
          />
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
  )
}

const SAGA_VIEW_KEYS = { pending: 'pending', missing: 'missing', ready: 'ready' } as const

type SagaViewViewProps = {
  [SAGA_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [SAGA_VIEW_KEYS.missing]: Record<never, never>
  [SAGA_VIEW_KEYS.ready]: ShownSagaProps
}

const SAGA_VIEW_VIEWS = {
  [SAGA_VIEW_KEYS.pending]: RouteState,
  [SAGA_VIEW_KEYS.missing]: NotFoundPage,
  [SAGA_VIEW_KEYS.ready]: ShownSaga,
} as const satisfies ViewsOf<SagaViewViewProps>

type SagaViewOfProps = { library: Library; page: RouteQuery<Saga | null> }

/** The library's sagas on their way or failing, this one not among them, or it. */
const sagaViewOf = ({ library, page }: SagaViewOfProps): ViewOf<SagaViewViewProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: SAGA_VIEW_KEYS.pending,
      props: { state: page, noun: SAGA_COPY.noun, shape: <SagaSkeleton /> },
    }
  if (page.data == null) return { key: SAGA_VIEW_KEYS.missing, props: {} }
  return { key: SAGA_VIEW_KEYS.ready, props: { library, saga: page.data } }
}

type SagaViewProps = { library: Library; sagaId: string }

/** The saga once its library is known and open to this browser. */
const SagaView = ({ library, sagaId }: SagaViewProps) => {
  const sagas = useQuery(sagasQuery(library.id))
  const page = routeState({
    id: library.id,
    query: {
      data: sagas.data && (sagas.data.find((saga) => saga.tmdbId === sagaId) ?? null),
      error: sagas.error,
    },
  })
  return (
    <KeyedView<SagaViewViewProps> views={SAGA_VIEW_VIEWS} view={sagaViewOf({ library, page })} />
  )
}

/** Nothing, while the browser checks whether the library is locked to it. */
const CheckingLock = () => null

const SAGA_PAGE_KEYS = {
  pending: 'pending',
  ...LIBRARY_LOCK_STATES,
} as const

type SagaPageViewProps = {
  [SAGA_PAGE_KEYS.pending]: Parameters<typeof RouteState>[0]
  [SAGA_PAGE_KEYS.checking]: Record<never, never>
  [SAGA_PAGE_KEYS.shut]: Parameters<typeof LockedLibrary>[0]
  [SAGA_PAGE_KEYS.open]: SagaViewProps
}

const SAGA_PAGE_VIEWS = {
  [SAGA_PAGE_KEYS.pending]: RouteState,
  [SAGA_PAGE_KEYS.checking]: CheckingLock,
  [SAGA_PAGE_KEYS.shut]: LockedLibrary,
  [SAGA_PAGE_KEYS.open]: SagaView,
} as const satisfies ViewsOf<SagaPageViewProps>

type SagaPageViewOfProps = { page: RouteQuery<Library>; lock: LibraryLock; sagaId: string }

/** The library on its way or failing, waiting on its lock, locked, or the saga in it. */
const sagaPageViewOf = ({ page, lock, sagaId }: SagaPageViewOfProps): ViewOf<SagaPageViewProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: SAGA_PAGE_KEYS.pending,
      props: { state: page, noun: SAGA_COPY.noun, shape: <SagaSkeleton /> },
    }
  switch (lock.state) {
    case LIBRARY_LOCK_STATES.checking:
      return { key: SAGA_PAGE_KEYS.checking, props: {} }
    case LIBRARY_LOCK_STATES.shut:
      return {
        key: SAGA_PAGE_KEYS.shut,
        props: { name: page.data.name },
      }
    case LIBRARY_LOCK_STATES.open:
      return { key: SAGA_PAGE_KEYS.open, props: { library: page.data, sagaId } }
    default: {
      const unknown: never = lock
      return unknown
    }
  }
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
  return (
    <KeyedView<SagaPageViewProps>
      views={SAGA_PAGE_VIEWS}
      view={sagaPageViewOf({ page, lock, sagaId })}
    />
  )
}
