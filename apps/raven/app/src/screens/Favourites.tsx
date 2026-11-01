import { LIBRARY_VIEWS, plural } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { Grid } from '@/layouts'
import type { ShelfCard } from '@/queries/cards'
import { favouriteSectionsOf } from '@/queries/favouriteCards'
import { showArtIdsOf } from '@/queries/showArt'
import { useShowArts } from '@/queries/useShowArts'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { hrefOf } from '@/routes'
import { FAVOURITES_COPY } from '@/screens/copy'

type ServerFavouritesProps = { session: AppQueries }

const ServerFavourites = ({ session: { server, api, queries } }: ServerFavouritesProps) => {
  const router = useRouter()
  const videos = useQuery(queries.favouritesQuery)
  const titles = useQuery(queries.favouriteTitlesQuery)
  const albums = useQuery(queries.favouriteAlbumsQuery)
  const artists = useQuery(queries.favouriteArtistsQuery)
  const pictures = usePictures({ server, api })
  const arts = useShowArts({
    queries,
    ids: [...(titles.data ?? []).map(({ id }) => id), ...showArtIdsOf(videos.data ?? [])],
    pictures,
  })
  const reads = [videos, titles, albums, artists]

  const sections =
    pictures === null
      ? []
      : favouriteSectionsOf({
          titles: titles.data ?? [],
          videos: videos.data ?? [],
          albums: albums.data ?? [],
          artists: artists.data ?? [],
          arts,
          api,
          headersFor: pictures.headersFor,
        })
  const count = sections.reduce((total, { cards }) => total + cards.length, 0)
  const failure = reads.find((read) => read.error !== null)?.error ?? null
  const notice = ((): string | null => {
    if (count > 0) return null
    if (failure !== null) return failure.message
    return reads.every((read) => read.isSuccess) ? FAVOURITES_COPY.none : FAVOURITES_COPY.gathering
  })()

  return (
    <Grid
      icon={null}
      jump={null}
      line={count === 0 ? null : plural({ n: count, ...FAVOURITES_COPY.count })}
      notice={notice}
      onBack={() => router.back()}
      onOpen={({ target }: ShelfCard) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      title={FAVOURITES_COPY.title}
      toolbar={null}
      view={LIBRARY_VIEWS.grid}
    />
  )
}

/**
 * `/favourites`: every favourite across the libraries the viewer may see, as the web's page
 * lists them: shows and seasons, videos, albums and artists, most recently marked first. A
 * card opens its page. Each server gets a page of its own.
 */
export const Favourites = () => {
  const session = useAppQueries()
  return session !== null && <ServerFavourites key={session.server.id} session={session} />
}
