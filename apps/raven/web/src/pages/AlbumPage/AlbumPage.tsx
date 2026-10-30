import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AlbumDetails,
  MATCH_STATES,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  routeState,
} from '@raven/core'
import { Button } from '@raven/ui'
import { afterAlbumMatch, useAudioQueue } from '@raven/ui/headless'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AddToPlaylistDialog } from '@/components/AddToPlaylistDialog/AddToPlaylistDialog'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { AlbumMatchDialog } from '@/components/AlbumMatchDialog/AlbumMatchDialog'
import { BackButton } from '@/components/BackButton/BackButton'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { RouteState } from '@/components/RouteState/RouteState'
import { Bone } from '@/components/Skeleton/Skeleton'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { albumFacts, artistPath } from '@/lib/music'
import { POSTER_SIZES } from '@/lib/posters'
import { albumQuery, libraryQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { useAlbumFavourite } from '@/lib/useMusicFavourite'
import styles from '@/pages/AlbumPage/AlbumPage.module.scss'

type AlbumTrackControlsProps = TrailProps

/** A track row's own control: Add to playlist, which asks which one. */
const AlbumTrackControls = ({ track }: AlbumTrackControlsProps) => {
  const [isAdding, setAdding] = useState(false)
  return (
    <>
      <Button
        tone="ghost"
        icon="list"
        aria-label={`Add ${track.title} to a playlist`}
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
          label: library.data?.name ?? 'Library',
        }}
        className={styles.back}
      />
      <header className={styles.header}>
        <div className={styles.cover}>
          <AlbumCover album={album} sizes={POSTER_SIZES.album} />
        </div>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Album</p>
          <h1 id={titleId} className={styles.title}>
            {album.title}
          </h1>
          <p className={styles.artists}>
            {album.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 && ', '}
                <Link to={artistPath(artist.id)}>{artist.name}</Link>
              </span>
            ))}
          </p>
          <p className={styles.facts}>{albumFacts({ album }).join(' · ')}</p>
          {details.label !== null && <p className={styles.label}>{details.label}</p>}
          <div className={styles.actions}>
            <Button
              tone="primary"
              icon="play"
              disabled={tracks.length === 0}
              onClick={() => play(0)}
            >
              Play
            </Button>
            <Button
              icon="shuffle"
              disabled={tracks.length === 0}
              onClick={() => playTracks({ tracks, source, isShuffled: true })}
            >
              Shuffle
            </Button>
            <Button icon="skipNext" disabled={tracks.length === 0} onClick={() => playNext(tracks)}>
              Play next
            </Button>
            <Button icon="plus" disabled={tracks.length === 0} onClick={() => addToQueue(tracks)}>
              Add to queue
            </Button>
            <Button icon="list" disabled={tracks.length === 0} onClick={() => setAdding(true)}>
              Add to playlist
            </Button>
            <FavouriteButton isFavourite={details.isFavourite} onToggle={favourite.mutate} />
            <AdminOnly>
              <Button icon="wand" onClick={() => setFixing(true)}>
                {album.match === MATCH_STATES.unmatched ? 'Match' : 'Fix match'}
              </Button>
            </AdminOnly>
          </div>
        </div>
      </header>

      {discs.map((disc) => (
        <section key={disc} className={styles.disc} aria-label={`Disc ${disc}`}>
          {discs.length > 1 && <h2 className={styles.discTitle}>Disc {disc}</h2>}
          <TrackList
            tracks={tracks.filter((track) => track.disc === disc)}
            onPlay={(index) => play(tracks.findIndex((track) => track.disc === disc) + index)}
            shouldShowArtists={!isOneArtist}
            Trail={AlbumTrackControls}
            label={discs.length > 1 ? `Disc ${disc} tracks` : 'Tracks'}
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

/** `/albums/:id`: an album's cover, artists, facts and tracks, which play into the queue. */
export const AlbumPage = () => {
  const id = useRouteId()
  const album = useQuery(albumQuery(id))
  const page = routeState({ id, query: album })
  if (page.state !== ROUTE_STATES.ready) {
    return <RouteState state={page} noun="album" shape={<AlbumSkeleton />} />
  }
  return <AlbumView details={page.data} />
}
