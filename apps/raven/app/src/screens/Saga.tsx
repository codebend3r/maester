import {
  type Library as LibraryRecord,
  LIBRARY_VIEWS,
  ROUTE_STATES,
  type RouteQuery,
  type Saga as SagaRecord,
  isSagaId,
  routeIdOf,
  routeState,
  sagaFacts,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ComponentType } from 'react'

import { Grid, ToolButton } from '@/layouts'
import { sagaFilmsSectionsOf, sagaPlayTarget } from '@/queries/sagaCards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTE_PARAMS, hrefOf } from '@/routes'
import { SAGA_COPY } from '@/screens/copy'
import { RouteError, RouteLoading, RouteMissing, type RouteViewProps } from '@/screens/RouteNotices'
import { APP_ICONS } from '@/theme/icons'

type SagaGridProps = { session: AppQueries; saga: SagaRecord }

/** The saga's movies as posters, oldest first, with Play all, which plays them in the saga's session. */
const SagaGrid = ({ session, saga }: SagaGridProps) => {
  const { server, api } = session
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const play = sagaPlayTarget({ sagaId: saga.tmdbId, media: saga.media })
  const sections =
    pictures === null ? [] : sagaFilmsSectionsOf({ saga, api, headersFor: pictures.headersFor })
  return (
    <Grid
      icon={null}
      jump={null}
      line={sagaFacts(saga).join(', ')}
      notice={null}
      onBack={() => router.back()}
      onOpen={({ target }) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      title={saga.name}
      toolbar={
        play !== null && (
          <ToolButton
            accessibilityLabel={SAGA_COPY.playAll}
            icon={APP_ICONS.play}
            label={SAGA_COPY.playAll}
            onPress={() => router.push(hrefOf(play))}
          />
        )
      }
      view={LIBRARY_VIEWS.grid}
    />
  )
}

type ServerSagaViewProps = RouteViewProps<SagaRecord[]> & {
  session: AppQueries
  sagaId: string | null
}

type SagaReadyProps = ServerSagaViewProps

type SagaFoundProps = SagaReadyProps & { saga: SagaRecord | null }

const SagaFound = ({ saga, session }: SagaFoundProps) =>
  saga !== null && <SagaGrid saga={saga} session={session} />

/** Whether the saga the address names is in the library's list. */
const SAGA_FINDS = { found: 'found', missing: 'missing' } as const

type SagaFind = (typeof SAGA_FINDS)[keyof typeof SAGA_FINDS]

const SAGA_FIND_VIEWS = {
  [SAGA_FINDS.found]: SagaFound,
  [SAGA_FINDS.missing]: RouteMissing,
} as const satisfies Record<SagaFind, ComponentType<SagaFoundProps>>

/** A saga the library no longer lists is as missing as one the address misnames. */
const SagaReady = (props: SagaReadyProps) => {
  const { page, sagaId } = props
  const saga =
    (page.state === ROUTE_STATES.ready
      ? page.data.find((each) => each.tmdbId === sagaId)
      : undefined) ?? null
  const View = SAGA_FIND_VIEWS[saga === null ? SAGA_FINDS.missing : SAGA_FINDS.found]
  return <View {...props} saga={saga} />
}

const SERVER_SAGA_VIEWS = {
  [ROUTE_STATES.missing]: RouteMissing,
  [ROUTE_STATES.error]: RouteError,
  [ROUTE_STATES.loading]: RouteLoading,
  [ROUTE_STATES.ready]: SagaReady,
} as const satisfies Record<RouteQuery<SagaRecord[]>['state'], ComponentType<ServerSagaViewProps>>

type ServerSagaProps = {
  session: AppQueries
  libraryId: LibraryRecord['id'] | null
  sagaId: string | null
}

const ServerSaga = ({ session, libraryId, sagaId }: ServerSagaProps) => {
  const router = useRouter()
  const sagas = useQuery(session.queries.sagasQuery(libraryId))
  const page = routeState({ id: sagaId === null ? null : libraryId, query: sagas })
  const PageView = SERVER_SAGA_VIEWS[page.state]
  return (
    <PageView
      copy={SAGA_COPY}
      onBack={() => router.back()}
      page={page}
      sagaId={sagaId}
      session={session}
    />
  )
}

/** `/saga/[id]?library=`: a saga's movies, from the library that lists it, and Play all. */
export const Saga = () => {
  const session = useAppQueries()
  const params = useLocalSearchParams()
  const libraryId = routeIdOf(params[APP_ROUTE_PARAMS.library])
  const id = params[APP_ROUTE_PARAMS.id]
  return (
    session !== null && (
      <ServerSaga
        key={session.server.id}
        libraryId={libraryId}
        sagaId={isSagaId(id) ? id : null}
        session={session}
      />
    )
  )
}
