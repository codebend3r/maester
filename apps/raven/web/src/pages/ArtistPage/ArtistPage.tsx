import { useQuery } from '@tanstack/react-query'
import { type ArtistDetails, ROUTE_STATES, routeState } from '@raven/core'
import { useId } from 'react'
import { AlbumGrid, AlbumGridSkeleton } from '@/components/AlbumGrid/AlbumGrid'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { RouteState } from '@/components/RouteState/RouteState'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { Bone } from '@/components/Skeleton/Skeleton'
import { artistQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { useArtistFavourite } from '@/lib/useMusicFavourite'
import styles from '@/pages/ArtistPage/ArtistPage.module.scss'

const count = new Intl.NumberFormat()

type ArtistViewProps = { details: ArtistDetails }

/** The page once its artist is known: the name and counts, their albums, and the albums of others they appear on. */
const ArtistView = ({ details }: ArtistViewProps) => {
  const titleId = useId()
  const albumsId = useId()
  const appearsId = useId()
  const { artist, albums, appearsOn } = details
  const favourite = useArtistFavourite({ artistId: artist.id })
  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={HOME} className={styles.back} />
      <header className={styles.header}>
        <p className={styles.eyebrow}>Artist</p>
        <div className={styles.titleRow}>
          <h1 id={titleId} className={styles.title}>
            {artist.name}
          </h1>
          <FavouriteButton isFavourite={details.isFavourite} onToggle={favourite.mutate} />
        </div>
        <p className={styles.count}>
          {count.format(artist.albumCount)} {artist.albumCount === 1 ? 'album' : 'albums'} ·{' '}
          {count.format(artist.trackCount)} {artist.trackCount === 1 ? 'track' : 'tracks'}
        </p>
      </header>
      {albums.length > 0 && (
        <section className={styles.section} aria-labelledby={albumsId}>
          <SectionHeading id={albumsId}>Albums</SectionHeading>
          <AlbumGrid albums={albums} />
        </section>
      )}
      {appearsOn.length > 0 && (
        <section className={styles.section} aria-labelledby={appearsId}>
          <SectionHeading id={appearsId}>Appears on</SectionHeading>
          <AlbumGrid albums={appearsOn} />
        </section>
      )}
      {albums.length === 0 && appearsOn.length === 0 && (
        <p className={styles.empty}>No albums of {artist.name}'s are in a library you can see.</p>
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

/** `/artists/:id`: an artist's albums, and the albums of others they appear on. */
export const ArtistPage = () => {
  const id = useRouteId()
  const artist = useQuery(artistQuery(id))
  const page = routeState({ id, query: artist })
  if (page.state !== ROUTE_STATES.ready) {
    return <RouteState state={page} noun="artist" shape={<ArtistSkeleton />} />
  }
  return <ArtistView details={page.data} />
}
