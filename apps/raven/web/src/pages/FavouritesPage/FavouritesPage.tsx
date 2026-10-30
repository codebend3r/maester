import { useQuery } from '@tanstack/react-query'
import {
  type AlbumSummary,
  type Artist,
  ITEM_TYPES,
  type ItemSummary,
  type MediaItem,
  type PosterEntry,
  plural,
} from '@raven/core'
import { useId } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ArtistList } from '@/components/ArtistList/ArtistList'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PosterCard } from '@/components/PosterCard/PosterCard'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { Loading, SkeletonCards } from '@/components/Skeleton/Skeleton'
import { TitleCard } from '@/components/TitleCard/TitleCard'
import { POSTER_SIZES } from '@/lib/posters'
import {
  favouriteAlbumsQuery,
  favouriteArtistsQuery,
  favouriteTitlesQuery,
  favouritesQuery,
} from '@/lib/queries'
import { FAVOURITES_COPY } from '@/pages/FavouritesPage/copy'
import styles from '@/pages/FavouritesPage/FavouritesPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'

/** What a favourite can be, in the order the filter offers them. */
const KINDS = {
  shows: 'shows',
  seasons: 'seasons',
  movies: 'movies',
  episodes: 'episodes',
  other: 'other',
  albums: 'albums',
  artists: 'artists',
} as const

type Kind = (typeof KINDS)[keyof typeof KINDS]

const KIND_ORDER: readonly Kind[] = Object.values(KINDS)

const KIND_LABELS = {
  [KINDS.shows]: 'Shows',
  [KINDS.seasons]: 'Seasons',
  [KINDS.movies]: 'Movies',
  [KINDS.episodes]: 'Episodes',
  [KINDS.other]: 'Other videos',
  [KINDS.albums]: 'Albums',
  [KINDS.artists]: 'Artists',
} as const satisfies Record<Kind, string>

const isKind = (value: string | null): value is Kind => KIND_ORDER.some((kind) => kind === value)

/** A favourite title is a show or a season; anything else is a video's. */
const titleKindOf = (item: ItemSummary): Kind =>
  item.type === ITEM_TYPES.season ? KINDS.seasons : KINDS.shows

/** A favourite video is a movie's, an episode's, or one matched to neither. */
const kindOf = (media: MediaItem): Kind => {
  switch (media.item?.type ?? null) {
    case ITEM_TYPES.movie:
      return KINDS.movies
    case ITEM_TYPES.episode:
      return KINDS.episodes
    default:
      return KINDS.other
  }
}

type KindsInProps = {
  titles: readonly ItemSummary[]
  entries: readonly PosterEntry[]
  albums: readonly AlbumSummary[]
  artists: readonly Artist[]
}

/** The kinds among the favourites, in the filter's order. */
const kindsIn = ({ titles, entries, albums, artists }: KindsInProps): Kind[] => {
  const present = new Set<Kind>([
    ...titles.map(titleKindOf),
    ...entries.map(({ media }) => kindOf(media)),
    ...(albums.length > 0 ? [KINDS.albums] : []),
    ...(artists.length > 0 ? [KINDS.artists] : []),
  ])
  return KIND_ORDER.filter((kind) => present.has(kind))
}

type ShownOfProps<T> = { all: readonly T[]; own: Kind; kind: Kind | null }

/** A list of one kind as the filter leaves it: whole for All or its own kind, else empty. */
const shownOf = <T,>({ all, own, kind }: ShownOfProps<T>): readonly T[] =>
  kind === null || kind === own ? all : []

/**
 * Every favourite across every library but the locked ones: the shows and
 * seasons, then the videos, as posters, each most recently marked first; a
 * movie's own poster, an episode's season's. The albums follow as covers,
 * then the artists, each under its own heading. With more than one kind
 * among them, pills narrow them to one; the kind rides in the address as
 * `?kind=`, so coming back from a video lands on the same pills.
 */
export const FavouritesPage = () => {
  const id = useId()
  const albumsId = useId()
  const artistsId = useId()
  const videos = useQuery(favouritesQuery)
  const titleQuery = useQuery(favouriteTitlesQuery)
  const albumQuery = useQuery(favouriteAlbumsQuery)
  const artistQuery = useQuery(favouriteArtistsQuery)
  const [searchParams, setSearchParams] = useSearchParams()
  const all = videos.data ?? []
  const allTitles = titleQuery.data ?? []
  const allAlbums = albumQuery.data ?? []
  const allArtists = artistQuery.data ?? []
  const kinds = kindsIn({
    titles: allTitles,
    entries: all,
    albums: allAlbums,
    artists: allArtists,
  })
  const asked = searchParams.get('kind')
  const kind = isKind(asked) && kinds.includes(asked) ? asked : null
  const items = kind ? all.filter(({ media }) => kindOf(media) === kind) : all
  const titles = kind ? allTitles.filter((item) => titleKindOf(item) === kind) : allTitles
  const albums = shownOf({ all: allAlbums, own: KINDS.albums, kind })
  const artists = shownOf({ all: allArtists, own: KINDS.artists, kind })
  const queries = [videos, titleQuery, albumQuery, artistQuery]
  const error = queries.find((query) => query.error !== null)?.error ?? null
  const isSuccess = queries.every((query) => query.isSuccess)
  const posters = titles.length + items.length
  const shown = posters + albums.length + artists.length
  // Each list shows as it comes; the stand-in cards only while none has anything to show.
  const isPending = queries.some((query) => query.isPending) && shown === 0

  return (
    <section className={styles.page} aria-labelledby={id}>
      <BackButton fallback={HOME} />
      <header className={styles.header}>
        <PageTitle id={id} icon="heart">
          {COMMON_COPY.favourites}
        </PageTitle>
        {isSuccess && (
          <p className={styles.count}>
            {plural({ n: shown, one: FAVOURITES_COPY.favourite, many: FAVOURITES_COPY.favourites })}
          </p>
        )}
      </header>

      {kinds.length > 1 && (
        <fieldset className={styles.kinds}>
          <legend className="visually-hidden">{FAVOURITES_COPY.show}</legend>
          {[null, ...kinds].map((option) => (
            <button
              key={option ?? 'all'}
              type="button"
              className={styles.kind}
              aria-pressed={kind === option}
              onClick={() => setSearchParams(option ? { kind: option } : {}, { replace: true })}
            >
              {option ? KIND_LABELS[option] : COMMON_COPY.all}
            </button>
          ))}
        </fieldset>
      )}

      {error && (
        <p className={styles.message} role="alert">
          {error.message}
        </p>
      )}
      {isPending && !error && (
        <Loading label={FAVOURITES_COPY.loading}>
          <ul className={styles.grid}>
            <SkeletonCards picture="poster" />
          </ul>
        </Loading>
      )}
      {isSuccess && all.length + allTitles.length + allAlbums.length + allArtists.length === 0 && (
        <p className={styles.message}>{FAVOURITES_COPY.empty}</p>
      )}
      {posters > 0 && (
        <ul className={styles.grid}>
          {titles.map((item) => (
            <TitleCard key={`title-${item.id}`} item={item} />
          ))}
          {items.map(({ media, poster }) => (
            <PosterCard key={media.id} media={media} poster={poster} sizes={POSTER_SIZES.grid} />
          ))}
        </ul>
      )}
      {albums.length > 0 && (
        <section className={styles.music} aria-labelledby={albumsId}>
          <SectionHeading id={albumsId}>{COMMON_COPY.albums}</SectionHeading>
          <AlbumGrid albums={albums} />
        </section>
      )}
      {artists.length > 0 && (
        <section className={styles.music} aria-labelledby={artistsId}>
          <SectionHeading id={artistsId}>{FAVOURITES_COPY.artists}</SectionHeading>
          <ArtistList artists={artists} label={FAVOURITES_COPY.artistsLabel} />
        </section>
      )}
    </section>
  )
}
