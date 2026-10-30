import { useQuery } from '@tanstack/react-query'
import {
  type PlaylistDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  type Track,
  routeState,
} from '@raven/core'
import { Button, useCanGoBack } from '@raven/ui'
import { useAudioQueue } from '@raven/ui/headless'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog/PlaylistNameDialog'
import { RouteState } from '@/components/RouteState/RouteState'
import { Bone } from '@/components/Skeleton/Skeleton'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { playlistFacts } from '@/lib/music'
import { playlistQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
import { DeletePlaylistDialog } from '@/pages/PlaylistPage/DeletePlaylistDialog'
import styles from '@/pages/PlaylistPage/PlaylistPage.module.scss'

/** What the page has open over it: nothing, the rename, or the delete. */
const OPEN_DIALOGS = { none: 'none', rename: 'rename', remove: 'remove' } as const

type OpenDialog = (typeof OPEN_DIALOGS)[keyof typeof OPEN_DIALOGS]

type MovedUpProps = { tracks: readonly Track[]; index: number }

/** `tracks` with the one at `index` a place higher; the very same list for the first. */
const movedUp = ({ tracks, index }: MovedUpProps): readonly Track[] => {
  const moving = tracks[index]
  const above = tracks[index - 1]
  if (moving === undefined || above === undefined) return tracks
  return tracks.with(index - 1, moving).with(index, above)
}

type PlaylistTrackControlsProps = TrailProps

/** A playlist row's controls: up one place, and out of the playlist. Each sends the whole new order. */
const PlaylistTrackControls = ({ track, index }: PlaylistTrackControlsProps) => {
  const id = useRouteId()
  const playlist = useQuery(playlistQuery(id))
  const { setTracks } = usePlaylistMutations()
  const tracks = playlist.data?.tracks ?? []
  if (id === null) return null
  return (
    <>
      <Button
        tone="ghost"
        icon="up"
        aria-label={`Move ${track.title} up`}
        disabled={index === 0}
        onClick={() => setTracks.mutate({ id, tracks: movedUp({ tracks, index }) })}
      />
      <Button
        tone="ghost"
        icon="close"
        aria-label={`Remove ${track.title} from the playlist`}
        onClick={() =>
          setTracks.mutate({ id, tracks: tracks.filter((_track, place) => place !== index) })
        }
      />
    </>
  )
}

type PlaylistViewProps = { details: PlaylistDetails }

/** The page once its playlist is known: its name and length, Play, Shuffle, Rename and Delete, then its tracks. */
const PlaylistView = ({ details }: PlaylistViewProps) => {
  const titleId = useId()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const { playlist, tracks } = details
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { rename, setTracks } = usePlaylistMutations()
  const [dialog, setDialog] = useState<OpenDialog>(OPEN_DIALOGS.none)
  const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id }
  const closeDialog = () => setDialog(OPEN_DIALOGS.none)
  const failure = setTracks.failure ?? rename.failure
  // A deleted playlist's page has nothing to show, so the way back is taken for the listener.
  const leave = () => void (canGoBack ? navigate(-1) : navigate(HOME.to))

  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={HOME} className={styles.back} />
      <header className={styles.header}>
        <p className={styles.eyebrow}>Playlist</p>
        <h1 id={titleId} className={styles.title}>
          {playlist.name}
        </h1>
        <p className={styles.facts}>{playlistFacts({ playlist }).join(' · ')}</p>
        <div className={styles.actions}>
          <Button
            tone="primary"
            icon="play"
            disabled={tracks.length === 0}
            onClick={() => playTracks({ tracks, source })}
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
          <Button icon="edit" onClick={() => setDialog(OPEN_DIALOGS.rename)}>
            Rename
          </Button>
          <Button icon="trash" onClick={() => setDialog(OPEN_DIALOGS.remove)}>
            Delete
          </Button>
        </div>
        {failure !== null && (
          <p className={styles.error} role="alert">
            Could not change the playlist: {failure.message}
          </p>
        )}
      </header>

      {tracks.length === 0 ? (
        <p className={styles.empty}>
          Nothing in {playlist.name} yet. Add tracks from an album, or from Now playing.
        </p>
      ) : (
        <TrackList
          tracks={tracks}
          onPlay={(index) => playTracks({ tracks, startAt: index, source })}
          numberOf={({ index }) => index + 1}
          Trail={PlaylistTrackControls}
          label="Tracks"
        />
      )}

      {dialog === OPEN_DIALOGS.rename && (
        <PlaylistNameDialog
          title="Rename playlist"
          initialName={playlist.name}
          submitLabel="Rename"
          isPending={false}
          error={null}
          onSubmit={(name) => {
            rename.mutate({ id: playlist.id, name })
            closeDialog()
          }}
          onClose={closeDialog}
        />
      )}
      {dialog === OPEN_DIALOGS.remove && (
        <DeletePlaylistDialog playlist={playlist} onClose={closeDialog} onDeleted={leave} />
      )}
    </article>
  )
}

/** The page before its playlist is known: a title and a few rows. */
const PlaylistSkeleton = () => (
  <>
    <Bone shape="button" />
    <Bone shape="text" width="short" />
    <Bone shape="text" width="most" />
    <Bone shape="text" width="most" />
  </>
)

/** `/playlists/:id`: one of the account's playlists, its tracks in order, played, reordered and renamed here. */
export const PlaylistPage = () => {
  const id = useRouteId()
  const playlist = useQuery(playlistQuery(id))
  const page = routeState({ id, query: playlist })
  if (page.state !== ROUTE_STATES.ready) {
    return <RouteState state={page} noun="playlist" shape={<PlaylistSkeleton />} />
  }
  return <PlaylistView details={page.data} />
}
