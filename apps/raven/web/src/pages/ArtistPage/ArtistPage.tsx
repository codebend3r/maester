import { useQuery } from '@tanstack/react-query'
import {
  type ArtistDetails,
  RADIO_SEED_KINDS,
  ROUTE_STATES,
  type RouteQuery,
  routeState,
} from '@raven/core'
import { useId } from 'react'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { AlbumGrid, AlbumGridSkeleton } from '@/components/AlbumGrid/AlbumGrid'
import { BackButton } from '@/components/BackButton/BackButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { RouteState } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { Bone } from '@/components/Skeleton/Skeleton'
import { START_RADIO_LOOKS, StartRadio } from '@/components/StartRadio/StartRadio'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { artistQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { useArtistFavourite } from '@/lib/useMusicFavourite'
import { ARTIST_COPY } from '@/pages/ArtistPage/copy'
import styles from '@/pages/ArtistPage/ArtistPage.module.scss'
import { COMMON_COPY, MUSIC_COPY } from '@/lib/copy'

type ArtistViewProps = { details: ArtistDetails }

/** The page once its artist is known: the name and counts, their albums, and the albums of others they appear on. */
const ArtistView = ({ details }: ArtistViewProps) => {
  const titleId = useId()
  const albumsId = useId()
  const appearsId = useId()
  const { artist, albums, appearsOn } = details
  const favourite = useArtistFavourite({ artistId: artist.id })
  const links = useMusicLinks()
  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={links.home} className={styles.back} />
      <header className={styles.header}>
        <p className={styles.eyebrow}>{ARTIST_COPY.eyebrow}</p>
        <div className={styles.titleRow}>
          <h1 id={titleId} className={styles.title}>
            {artist.name}
          </h1>
          <FavouriteButton isFavourite={details.isFavourite} onToggle={favourite.mutate} />
          <StartRadio
            seed={{ kind: RADIO_SEED_KINDS.artist, id: artist.id }}
            title={artist.name}
            look={START_RADIO_LOOKS.icon}
          />
        </div>
        <p className={styles.count}>{MUSIC_COPY.artistCounts(artist)}</p>
      </header>
      {albums.length > 0 && (
        <section className={styles.section} aria-labelledby={albumsId}>
          <SectionHeading id={albumsId}>{COMMON_COPY.albums}</SectionHeading>
          <AlbumGrid albums={albums} />
        </section>
      )}
      {appearsOn.length > 0 && (
        <section className={styles.section} aria-labelledby={appearsId}>
          <SectionHeading id={appearsId}>{ARTIST_COPY.appearsOn}</SectionHeading>
          <AlbumGrid albums={appearsOn} />
        </section>
      )}
      {albums.length === 0 && appearsOn.length === 0 && (
        <p className={styles.empty}>{ARTIST_COPY.empty(artist.name)}</p>
      )}
    </article>
  )
}

const ArtistSkeleton = () => (
  <>
    <Bone shape="button" />
    <Bone shape="hero" width="half" />
    <Bone shape="text" width="short" />
    <AlbumGridSkeleton />
  </>
)

const ARTIST_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type ArtistPageViewProps = {
  [ARTIST_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [ARTIST_VIEW_KEYS.ready]: ArtistViewProps
}

const ARTIST_VIEWS = {
  [ARTIST_VIEW_KEYS.pending]: RouteState,
  [ARTIST_VIEW_KEYS.ready]: ArtistView,
} as const satisfies ViewsOf<ArtistPageViewProps>

type ArtistPageViewOfProps = { page: RouteQuery<ArtistDetails> }

/** Which view the page shows: the artist on its way, missing or failing, or the artist. */
const artistPageViewOf = ({ page }: ArtistPageViewOfProps): ViewOf<ArtistPageViewProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: ARTIST_VIEW_KEYS.pending,
      props: { state: page, noun: ARTIST_COPY.noun, shape: <ArtistSkeleton /> },
    }
  return { key: ARTIST_VIEW_KEYS.ready, props: { details: page.data } }
}

/** `/artists/:id`: an artist's albums, and the albums of others they appear on. */
export const ArtistPage = () => {
  const id = useRouteId()
  const artist = useQuery(artistQuery(id))
  const page = routeState({ id, query: artist })
  return <KeyedView<ArtistPageViewProps> views={ARTIST_VIEWS} view={artistPageViewOf({ page })} />
}
