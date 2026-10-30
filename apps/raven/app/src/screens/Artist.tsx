import {
  type ArtistDetails,
  LIBRARY_VIEWS,
  ROUTE_STATES,
  type RouteQuery,
  plural,
  routeIdOf,
  routeState,
} from '@raven/core'
import { useServerArtistFavourite } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ComponentType } from 'react'

import { FavouriteButton, Grid } from '@/layouts'
import { MUSIC_COPY } from '@/layouts/copy'
import { artistSectionsOf } from '@/music/musicCards'
import type { ShelfCard } from '@/queries/cards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTE_PARAMS, hrefOf } from '@/routes'
import { ARTIST_COPY } from '@/screens/copy'
import { RouteError, RouteLoading, RouteMissing, type RouteViewProps } from '@/screens/RouteNotices'

type ArtistGridProps = { session: AppQueries; details: ArtistDetails }

/** The artist's albums as a grid, then the albums of others they appear on, and their favourite mark. */
const ArtistGrid = ({ session: { server, api }, details }: ArtistGridProps) => {
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const { artist, albums, appearsOn, isFavourite } = details
  const favourite = useServerArtistFavourite({ api, artistId: artist.id })
  const sections =
    pictures === null
      ? []
      : artistSectionsOf({ api, headersFor: pictures.headersFor, albums, appearsOn })
  return (
    <Grid
      icon={null}
      jump={null}
      line={plural({ n: albums.length, ...MUSIC_COPY.albums })}
      notice={null}
      onBack={() => router.back()}
      onOpen={({ target }: ShelfCard) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      title={artist.name}
      toolbar={
        <FavouriteButton
          isFavourite={isFavourite}
          onToggle={() => favourite.mutate(!isFavourite)}
        />
      }
      view={LIBRARY_VIEWS.grid}
    />
  )
}

type ServerArtistViewProps = RouteViewProps<ArtistDetails> & { session: AppQueries }

type ArtistReadyProps = ServerArtistViewProps

const ArtistReady = ({ page, session }: ArtistReadyProps) =>
  page.state === ROUTE_STATES.ready && <ArtistGrid details={page.data} session={session} />

/** What the page draws in each state its read is in. */
const SERVER_ARTIST_VIEWS = {
  [ROUTE_STATES.missing]: RouteMissing,
  [ROUTE_STATES.error]: RouteError,
  [ROUTE_STATES.loading]: RouteLoading,
  [ROUTE_STATES.ready]: ArtistReady,
} as const satisfies Record<
  RouteQuery<ArtistDetails>['state'],
  ComponentType<ServerArtistViewProps>
>

type ServerArtistProps = { session: AppQueries; id: number | null }

const ServerArtist = ({ session, id }: ServerArtistProps) => {
  const router = useRouter()
  const artist = useQuery(session.queries.artistQuery(id))
  const page = routeState({ id, query: artist })
  const back = () => router.back()
  const PageView = SERVER_ARTIST_VIEWS[page.state]
  return <PageView copy={ARTIST_COPY} onBack={back} page={page} session={session} />
}

/** `/artist/[id]`: the artist's albums, and the albums of others they appear on. */
export const Artist = () => {
  const session = useAppQueries()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  return session !== null && <ServerArtist key={session.server.id} id={id} session={session} />
}
