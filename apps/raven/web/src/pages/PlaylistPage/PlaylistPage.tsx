import { useQuery } from '@tanstack/react-query'
import {
  DOWNLOAD_TARGET_KINDS,
  type PlaylistDetails,
  QUEUE_SOURCE_KINDS,
  ROUTE_STATES,
  type RouteQuery,
  type Track,
  routeState,
} from '@raven/core'
import { Button, useCanGoBack } from '@raven/ui'
import { useAudioQueue } from '@raven/ui/headless'
import { type ComponentProps, type ComponentType, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BackButton } from '@/components/BackButton/BackButton'
import { DownloadButton } from '@/components/DownloadButton/DownloadButton'
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog/PlaylistNameDialog'
import { RouteState } from '@/components/RouteState/RouteState'
import { Bone } from '@/components/Skeleton/Skeleton'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { playlistFacts } from '@/lib/music'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { playlistQuery } from '@/lib/queries'
import { useRouteId } from '@/lib/routeQuery'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
import { PLAYLIST_PAGE_COPY } from '@/pages/PlaylistPage/copy'
import { DeletePlaylistDialog } from '@/pages/PlaylistPage/DeletePlaylistDialog'
import styles from '@/pages/PlaylistPage/PlaylistPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

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
  return (
    id !== null && (
      <>
        <Button
          tone="ghost"
          icon="up"
          aria-label={PLAYLIST_PAGE_COPY.moveUp(track.title)}
          disabled={index === 0}
          onClick={() => setTracks.mutate({ id, tracks: movedUp({ tracks, index }) })}
        />
        <Button
          tone="ghost"
          icon="close"
          aria-label={PLAYLIST_PAGE_COPY.takeOut(track.title)}
          onClick={() =>
            setTracks.mutate({ id, tracks: tracks.filter((_track, place) => place !== index) })
          }
        />
      </>
    )
  )
}

/** A row's controls as the track list takes them; none on another account's playlist. */
type RowTrail = ComponentProps<typeof TrackList>['Trail']

/** Whether the playlist has tracks to list, or is empty. */
const TRACK_VIEW_KEYS = { empty: 'empty', listed: 'listed' } as const
type TrackViewKey = (typeof TRACK_VIEW_KEYS)[keyof typeof TRACK_VIEW_KEYS]

type PlaylistTracksProps = {
  details: PlaylistDetails
  Trail: RowTrail
  onPlay: (index: number) => void
}

type EmptyTracksProps = PlaylistTracksProps

const EmptyTracks = ({ details }: EmptyTracksProps) => (
  <p className={styles.empty}>{PLAYLIST_PAGE_COPY.empty(details.playlist.name)}</p>
)

type ListedTracksProps = PlaylistTracksProps

const ListedTracks = ({ details, Trail, onPlay }: ListedTracksProps) => (
  <TrackList
    tracks={details.tracks}
    onPlay={onPlay}
    numberOf={({ index }) => index + 1}
    Trail={Trail}
    label={PLAYLIST_PAGE_COPY.tracks}
  />
)

const TRACK_VIEWS = {
  [TRACK_VIEW_KEYS.empty]: EmptyTracks,
  [TRACK_VIEW_KEYS.listed]: ListedTracks,
} as const satisfies Record<TrackViewKey, ComponentType<PlaylistTracksProps>>

type PlaylistViewProps = { details: PlaylistDetails }

type PlaylistActionsProps = {
  details: PlaylistDetails
  /** The page's own, so the page says why any of them failed. */
  mutations: ReturnType<typeof usePlaylistMutations>
}

type OwnActionsProps = PlaylistActionsProps

/** The owner's actions: Shared, Rename and Delete, and the dialogs the last two open. */
const OwnActions = ({ details, mutations }: OwnActionsProps) => {
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const links = useMusicLinks()
  const { playlist } = details
  const { rename, share } = mutations
  const [dialog, setDialog] = useState<OpenDialog>(OPEN_DIALOGS.none)
  const closeDialog = () => setDialog(OPEN_DIALOGS.none)
  // A deleted playlist's page has nothing to show, so the way back is taken for the listener.
  const leave = () => void (canGoBack ? navigate(-1) : navigate(links.home.to))
  const isShared = share.isPending ? share.variables.isShared : playlist.isShared
  const sharedHintId = useId()
  return (
    <>
      <Button icon="edit" onClick={() => setDialog(OPEN_DIALOGS.rename)}>
        {PLAYLIST_PAGE_COPY.rename}
      </Button>
      <Button icon="trash" onClick={() => setDialog(OPEN_DIALOGS.remove)}>
        {COMMON_COPY.delete}
      </Button>
      <label className={styles.shared}>
        <input
          type="checkbox"
          role="switch"
          checked={isShared}
          aria-checked={isShared}
          aria-describedby={sharedHintId}
          disabled={share.isPending}
          onChange={(event) => share.mutate({ id: playlist.id, isShared: event.target.checked })}
        />
        {PLAYLIST_PAGE_COPY.shared}
      </label>
      <span id={sharedHintId} className="visually-hidden">
        {PLAYLIST_PAGE_COPY.sharedHint}
      </span>
      {dialog === OPEN_DIALOGS.rename && (
        <PlaylistNameDialog
          title={PLAYLIST_PAGE_COPY.renameTitle}
          initialName={playlist.name}
          submitLabel={PLAYLIST_PAGE_COPY.rename}
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
    </>
  )
}

type SharedActionsProps = PlaylistActionsProps

/** What another account's shared playlist offers: a copy of the account's own, opened once made. */
const SharedActions = ({ details, mutations }: SharedActionsProps) => {
  const navigate = useNavigate()
  const links = useMusicLinks()
  const { copy } = mutations
  return (
    <Button
      icon="copy"
      className={styles.copy}
      disabled={copy.isPending}
      onClick={() =>
        copy.mutate(details.playlist.id, {
          onSuccess: (copied) => void navigate(links.playlist(copied.playlist.id)),
        })
      }
    >
      {copy.isPending ? PLAYLIST_PAGE_COPY.copying : PLAYLIST_PAGE_COPY.copy}
    </Button>
  )
}

type FailureWordsProps = { change: Error | null; copy: Error | null }

/** Why the last change or copy failed, in words; null while none has. */
const failureWords = ({ change, copy }: FailureWordsProps): string | null => {
  if (copy !== null) return PLAYLIST_PAGE_COPY.copyFailed(copy.message)
  if (change !== null) return PLAYLIST_PAGE_COPY.changeFailed(change.message)
  return null
}

/** Whose the playlist is: the account's own, to change, or another's shared one, to read. */
const OWNERSHIPS = { own: 'own', shared: 'shared' } as const
type Ownership = (typeof OWNERSHIPS)[keyof typeof OWNERSHIPS]

const OWNED_BY = {
  [OWNERSHIPS.own]: {
    eyebrow: PLAYLIST_PAGE_COPY.eyebrow,
    Actions: OwnActions,
    Trail: PlaylistTrackControls,
  },
  [OWNERSHIPS.shared]: {
    eyebrow: PLAYLIST_PAGE_COPY.sharedEyebrow,
    Actions: SharedActions,
    Trail: undefined,
  },
} as const satisfies Record<
  Ownership,
  {
    eyebrow: string
    Actions: ComponentType<PlaylistActionsProps>
    Trail: RowTrail
  }
>

/**
 * The page once its playlist is known: its name and length, Play, Shuffle,
 * then the owner's Shared, Rename and Delete or Copy on another's, then its
 * tracks, which only the owner moves or takes out.
 */
const PlaylistView = ({ details }: PlaylistViewProps) => {
  const titleId = useId()
  const { playlist, tracks } = details
  const playTracks = useAudioQueue((store) => store.playTracks)
  const mutations = usePlaylistMutations()
  const { rename, setTracks, share, copy } = mutations
  const source = { kind: QUEUE_SOURCE_KINDS.playlist, id: playlist.id }
  const failure = failureWords({
    change: setTracks.failure ?? rename.failure ?? share.error,
    copy: copy.error,
  })
  const { eyebrow, Actions, Trail } = OWNED_BY[playlist.isOwn ? OWNERSHIPS.own : OWNERSHIPS.shared]
  const Tracks: ComponentType<PlaylistTracksProps> =
    TRACK_VIEWS[tracks.length === 0 ? TRACK_VIEW_KEYS.empty : TRACK_VIEW_KEYS.listed]
  const links = useMusicLinks()

  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={links.home} className={styles.back} />
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 id={titleId} className={styles.title}>
          {playlist.name}
        </h1>
        <p className={styles.facts}>{playlistFacts({ playlist }).join(COMMON_COPY.separator)}</p>
        <div className={styles.actions}>
          <Button
            tone="primary"
            icon="play"
            disabled={tracks.length === 0}
            onClick={() => playTracks({ tracks, source })}
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
          {tracks.length > 0 && (
            <DownloadButton
              target={{ kind: DOWNLOAD_TARGET_KINDS.playlist, playlistId: playlist.id }}
            />
          )}
          <Actions details={details} mutations={mutations} />
        </div>
        {failure !== null && (
          <p className={styles.error} role="alert">
            {failure}
          </p>
        )}
      </header>

      <Tracks
        details={details}
        Trail={Trail}
        onPlay={(index) => playTracks({ tracks, startAt: index, source })}
      />
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

type PlaylistPageViewProps = { page: RouteQuery<PlaylistDetails> }

type PlaylistPendingProps = PlaylistPageViewProps

/** The playlist missing, failing or on its way. */
const PlaylistPending = ({ page }: PlaylistPendingProps) =>
  page.state !== ROUTE_STATES.ready && (
    <RouteState state={page} noun={PLAYLIST_PAGE_COPY.noun} shape={<PlaylistSkeleton />} />
  )

type PlaylistReadyProps = PlaylistPageViewProps

const PlaylistReady = ({ page }: PlaylistReadyProps) =>
  page.state === ROUTE_STATES.ready && <PlaylistView details={page.data} />

const PLAYLIST_PAGE_VIEWS = {
  [ROUTE_STATES.missing]: PlaylistPending,
  [ROUTE_STATES.error]: PlaylistPending,
  [ROUTE_STATES.loading]: PlaylistPending,
  [ROUTE_STATES.ready]: PlaylistReady,
} as const satisfies Record<
  RouteQuery<PlaylistDetails>['state'],
  ComponentType<PlaylistPageViewProps>
>

/** `/playlists/:id`: one of the account's playlists, or another's shared one, its tracks in order, played here; the owner's reordered, renamed and shared here too. */
export const PlaylistPage = () => {
  const id = useRouteId()
  const playlist = useQuery(playlistQuery(id))
  const page = routeState({ id, query: playlist })
  const View: ComponentType<PlaylistPageViewProps> = PLAYLIST_PAGE_VIEWS[page.state]
  return <View page={page} />
}
