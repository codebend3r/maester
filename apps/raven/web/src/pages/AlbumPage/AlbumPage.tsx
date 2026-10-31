import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AlbumDetails,
  DOWNLOAD_TARGET_KINDS,
  MATCH_STATES,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  type RouteQuery,
  routeState,
} from '@raven/core'
import { Button } from '@raven/ui'
import {
  afterAlbumMatch,
  useAudioQueue,
  KeyedView,
  type ViewOf,
  type ViewsOf,
} from '@raven/ui/headless'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AddToPlaylistDialog } from '@/components/AddToPlaylistDialog/AddToPlaylistDialog'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { AlbumMatchDialog } from '@/components/AlbumMatchDialog/AlbumMatchDialog'
import { BackButton } from '@/components/BackButton/BackButton'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { RouteState } from '@/components/RouteState/RouteState'
import { Bone } from '@/components/Skeleton/Skeleton'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { albumFacts, artistPath } from '@/lib/music'
import { POSTER_SIZES } from '@/lib/posters'
import { albumQuery, libraryQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { useAlbumFavourite } from '@/lib/useMusicFavourite'
import { ALBUM_COPY } from '@/pages/AlbumPage/copy'
import styles from '@/pages/AlbumPage/AlbumPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type AlbumTrackControlsProps = TrailProps

/** A track row's own control: Add to playlist, which asks which one. */
const AlbumTrackControls = ({ track }: AlbumTrackControlsProps) => {
  const [isAdding, setAdding] = useState(false)
  return (
    <>
      <Button
        tone="ghost"
        icon="list"
        aria-label={ALBUM_COPY.addTrackToPlaylist(track.title)}
        onClick={() => setAdding(true)}
      />
      {isAdding && <AddToPlaylistDialog tracks={[track]} onClose={() => setAdding(false)} />}
    </>
  )
}

type AlbumViewProps = { details: AlbumDetails }

/** The page once its album is known: cover, title, artists and facts, Play and the rest, then the tracks by disc. */
const AlbumView = ({ details }: AlbumViewProps) => {
  const titleId = useId()
  const queryClient = useQueryClient()
  const { album } = details
  const library = useQuery(libraryQuery(album.libraryId))
  const playTracks = useAudioQueue((store) => store.playTracks)
  const playNext = useAudioQueue((store) => store.playNext)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const [isFixing, setFixing] = useState(false)
  const [isAdding, setAdding] = useState(false)
  const favourite = useAlbumFavourite({ albumId: album.id })
  const { tracks } = details
  const source = { kind: QUEUE_SOURCE_KINDS.album, id: album.id }
  const isOneArtist =
    album.artists.length === 1 &&
    tracks.every(
      (track) =>
        track.artists.length === 1 &&
        (track.artists[0]?.id ?? null) === (album.artists[0]?.id ?? null),
    )
  const play = (startAt: number) => playTracks({ tracks, startAt, source })
  const discs = [...new Set(tracks.map((track) => track.disc))].toSorted((a, b) => a - b)

  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <BackButton
        fallback={{
          to: `/libraries/${album.libraryId}`,
          label: library.data?.name ?? COMMON_COPY.library,
        }}
        className={styles.back}
      />
      <header className={styles.header}>
        <div className={styles.cover}>
          <AlbumCover album={album} sizes={POSTER_SIZES.album} />
        </div>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>{ALBUM_COPY.eyebrow}</p>
          <h1 id={titleId} className={styles.title}>
            {album.title}
          </h1>
          <p className={styles.artists}>
            {album.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 && COMMON_COPY.listSeparator}
                <Link to={artistPath(artist.id)}>{artist.name}</Link>
              </span>
            ))}
          </p>
          <p className={styles.facts}>{albumFacts({ album }).join(COMMON_COPY.separator)}</p>
          {details.label !== null && <p className={styles.label}>{details.label}</p>}
          <div className={styles.actions}>
            <Button
              tone="primary"
              icon="play"
              disabled={tracks.length === 0}
              onClick={() => play(0)}
            >
              {COMMON_COPY.play}
            </Button>
            <Button
              icon="shuffle"
              disabled={tracks.length === 0}
              onClick={() => playTracks({ tracks, source, isShuffled: true })}
            >
              {COMMON_COPY.shuffle}
            </Button>
            <Button icon="skipNext" disabled={tracks.length === 0} onClick={() => playNext(tracks)}>
              {ALBUM_COPY.playNext}
            </Button>
            <Button icon="plus" disabled={tracks.length === 0} onClick={() => addToQueue(tracks)}>
              {ALBUM_COPY.addToQueue}
            </Button>
            <Button icon="list" disabled={tracks.length === 0} onClick={() => setAdding(true)}>
              {COMMON_COPY.addToPlaylist}
            </Button>
            <FavouriteButton isFavourite={details.isFavourite} onToggle={favourite.mutate} />
            {tracks.length > 0 && (
              <DownloadButton target={{ kind: DOWNLOAD_TARGET_KINDS.album, albumId: album.id }} />
            )}
            <AdminOnly>
              <Button icon="wand" onClick={() => setFixing(true)}>
                {album.match === MATCH_STATES.unmatched ? ALBUM_COPY.match : COMMON_COPY.fixMatch}
              </Button>
            </AdminOnly>
          </div>
        </div>
      </header>

      {discs.map((disc) => (
        <section key={disc} className={styles.disc} aria-label={ALBUM_COPY.disc(disc)}>
          {discs.length > 1 && <h2 className={styles.discTitle}>{ALBUM_COPY.disc(disc)}</h2>}
          <TrackList
            tracks={tracks.filter((track) => track.disc === disc)}
            onPlay={(index) => play(tracks.findIndex((track) => track.disc === disc) + index)}
            shouldShowArtists={!isOneArtist}
            Trail={AlbumTrackControls}
            label={discs.length > 1 ? ALBUM_COPY.discTracks(disc) : ALBUM_COPY.tracks}
          />
        </section>
      ))}

      {isAdding && <AddToPlaylistDialog tracks={tracks} onClose={() => setAdding(false)} />}

      {isFixing && (
        <AlbumMatchDialog
          album={album}
          onClose={() => setFixing(false)}
          onMatched={() => {
            setFixing(false)
            void afterAlbumMatch({ queryClient, libraryId: album.libraryId })
          }}
        />
      )}
    </article>
  )
}

/** The page before its album is known: the cover's square, a title and a few rows. */
const AlbumSkeleton = () => (
  <>
    <Bone shape="button" />
    <Bone shape="hero" width="half" />
    <Bone shape="text" width="short" />
    <Bone shape="text" width="most" />
    <Bone shape="text" width="most" />
  </>
)

const ALBUM_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type AlbumPageViewProps = {
  [ALBUM_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [ALBUM_VIEW_KEYS.ready]: AlbumViewProps
}

const ALBUM_VIEWS = {
  [ALBUM_VIEW_KEYS.pending]: RouteState,
  [ALBUM_VIEW_KEYS.ready]: AlbumView,
} as const satisfies ViewsOf<AlbumPageViewProps>

type AlbumPageViewOfProps = { page: RouteQuery<AlbumDetails> }

/** Which view the page shows: the album on its way, missing or failing, or the album. */
const albumPageViewOf = ({ page }: AlbumPageViewOfProps): ViewOf<AlbumPageViewProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: ALBUM_VIEW_KEYS.pending,
      props: { state: page, noun: ALBUM_COPY.noun, shape: <AlbumSkeleton /> },
    }
  return { key: ALBUM_VIEW_KEYS.ready, props: { details: page.data } }
}

/** `/albums/:id`: an album's cover, artists, facts and tracks, which play into the queue. */
export const AlbumPage = () => {
  const id = useRouteId()
  const album = useQuery(albumQuery(id))
  const page = routeState({ id, query: album })
  return <KeyedView<AlbumPageViewProps> views={ALBUM_VIEWS} view={albumPageViewOf({ page })} />
}
