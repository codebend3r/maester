import {
  type ArtistDetails,
  LIBRARY_VIEWS,
  ROUTE_STATES,
  plural,
  routeIdOf,
  routeState,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { Grid, ItemNotice } from '@/layouts'
import { artistSectionsOf } from '@/music/musicCards'
import type { ShelfCard } from '@/queries/cards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTE_PARAMS, hrefOf } from '@/routes'

const COPY = {
  opening: 'Opening the artist',
  missing: 'This artist is not on the server.',
} as const

type ArtistGridProps = { session: AppQueries; details: ArtistDetails }

/** The artist's albums as a grid, then the albums of others they appear on. */
const ArtistGrid = ({ session: { server, api }, details }: ArtistGridProps) => {
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const { artist, albums, appearsOn } = details
  const sections =
    pictures === null
      ? []
      : artistSectionsOf({ api, headersFor: pictures.headersFor, albums, appearsOn })
  return (
    <Grid
      icon={null}
      jump={null}
      line={plural({ n: albums.length, one: 'album', many: 'albums' })}
      notice={null}
      onBack={() => router.back()}
      onOpen={({ target }: ShelfCard) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      title={artist.name}
      toolbar={null}
      view={LIBRARY_VIEWS.grid}
    />
  )
}

type ServerArtistProps = { session: AppQueries; id: number | null }

const ServerArtist = ({ session, id }: ServerArtistProps) => {
  const router = useRouter()
  const artist = useQuery(session.queries.artistQuery(id))
  const page = routeState({ id, query: artist })
  const back = () => router.back()
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <ItemNotice notice={COPY.missing} onBack={back} />
    case ROUTE_STATES.error:
      return <ItemNotice notice={page.message} onBack={back} />
    case ROUTE_STATES.loading:
      return <ItemNotice notice={COPY.opening} onBack={back} />
    case ROUTE_STATES.ready:
      return <ArtistGrid details={page.data} session={session} />
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/** `/artist/[id]`: the artist's albums, and the albums of others they appear on. */
export const Artist = () => {
  const session = useAppQueries()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  if (session === null) return null
  return <ServerArtist key={session.server.id} id={id} session={session} />
}
