import { useQuery } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  type Library,
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
import { BUTTON_TONES, Button, ButtonLink } from '@raven/ui'
import {
  KeyedView,
  LIBRARY_LOCK_STATES,
  type LibraryLock,
  type ViewOf,
  type ViewsOf,
} from '@raven/ui/headless'
import {
  HEADER_BACKDROP_TYPES,
  type HeaderBackdrop,
  itemBackdrop,
  ItemHeader,
  ItemHeaderSkeleton,
  PICTURE_SHAPES,
} from '@/components/ItemHeader/ItemHeader'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { LockedLibrary } from '@/components/LockedLibrary/LockedLibrary'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { RouteView } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import { SelectionScope, mediaEntryOf, sourceOf } from '@/components/SelectionScope/SelectionScope'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'
import { api } from '@/lib/api'
import { useLibraryLock } from '@/lib/libraryLock'
import { libraryQuery, sagasQuery } from '@/lib/queries'
import { pickRoute, useRouteId } from '@/lib/routeQuery'
import { useWatchedToggle } from '@/lib/useWatchedChange'
import { LIBRARY_SECTIONS, sectionPath } from '@/pages/LibraryPage/librarySections'
import { SagaBackdropDialog } from '@/pages/SagaPage/SagaBackdropDialog'
import { SagaFilms } from '@/pages/SagaPage/SagaFilms'
import { SAGA_COPY } from '@/pages/SagaPage/copy'
import styles from '@/pages/SagaPage/SagaPage.module.scss'
import { CARD_PICTURES } from '@/lib/cardPictures'

/** A saga on its way: its title and facts over stand-ins for its movies. */
const SagaSkeleton = () => (
  <>
    <ItemHeaderSkeleton picture={PICTURE_SHAPES.none} />
    <MediaGridSkeleton picture={CARD_PICTURES.poster} count={6} />
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
      const slides = sagaPictures(saga).map((picture) => ({
        src: api.sagaPictureUrl(picture),
        srcSet: api.backdropSrcSet(picture),
      }))
      return slides.length === 0
        ? null
        : { type: HEADER_BACKDROP_TYPES.slideshow, slides, motion: backdrop.motion }
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
              tone={BUTTON_TONES.primary}
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
          <SagaFilms media={saga.media} sagaId={saga.tmdbId} />
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

type SagaViewProps = { library: Library; sagaId: string }

/** The saga once its library is known and open to this browser: its sagas on their way or failing, this one not among them, or it. */
const SagaView = ({ library, sagaId }: SagaViewProps) => {
  const sagas = useQuery(sagasQuery(library.id))
  const page = pickRoute({
    page: routeState({ id: library.id, query: sagas }),
    pick: (listed) => listed.find((saga) => saga.tmdbId === sagaId) ?? null,
  })
  return (
    <RouteView page={page} noun={SAGA_COPY.noun} shape={<SagaSkeleton />}>
      {(saga) => <ShownSaga library={library} saga={saga} />}
    </RouteView>
  )
}

/** Nothing, while the browser checks whether the library is locked to it. */
const CheckingLock = () => null

type SagaLockViewsProps = {
  [LIBRARY_LOCK_STATES.checking]: Record<never, never>
  [LIBRARY_LOCK_STATES.shut]: Parameters<typeof LockedLibrary>[0]
  [LIBRARY_LOCK_STATES.open]: SagaViewProps
}

const SAGA_LOCK_VIEWS = {
  [LIBRARY_LOCK_STATES.checking]: CheckingLock,
  [LIBRARY_LOCK_STATES.shut]: LockedLibrary,
  [LIBRARY_LOCK_STATES.open]: SagaView,
} as const satisfies ViewsOf<SagaLockViewsProps>

type SagaLockViewOfProps = SagaViewProps & { lock: LibraryLock }

/** The library waiting on its lock, locked, or the saga in it. */
const sagaLockViewOf = ({
  library,
  lock,
  sagaId,
}: SagaLockViewOfProps): ViewOf<SagaLockViewsProps> => {
  switch (lock.state) {
    case LIBRARY_LOCK_STATES.checking:
      return { key: LIBRARY_LOCK_STATES.checking, props: {} }
    case LIBRARY_LOCK_STATES.shut:
      return {
        key: LIBRARY_LOCK_STATES.shut,
        props: { name: library.name, available: lock.canUnlock },
      }
    case LIBRARY_LOCK_STATES.open:
      return { key: LIBRARY_LOCK_STATES.open, props: { library, sagaId } }
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
    <RouteView page={page} noun={SAGA_COPY.noun} shape={<SagaSkeleton />}>
      {(shown) => (
        <KeyedView<SagaLockViewsProps>
          views={SAGA_LOCK_VIEWS}
          view={sagaLockViewOf({ library: shown, lock, sagaId })}
        />
      )}
    </RouteView>
  )
}
