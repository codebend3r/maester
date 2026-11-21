import type { PlaylistSummary, Track } from '@raven/core'
import { NEW_PLAYLIST_COPY, TRACK_MENU_COPY, countsLineOf } from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { type PickedPlaylist, useAddToPlaylist } from '@/components/AddToPlaylist/useAddToPlaylist'
import { Notice } from '@/components/Notice/Notice'
import { queries } from '@/lib/queries'
import { RADII, SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { EmptyState } from '@/ui/EmptyState/EmptyState'
import { NewPlaylistForm } from '@/ui/NewPlaylistForm/NewPlaylistForm'
import { Pressable } from '@/ui/Pressable/Pressable'
import { ICONS } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/components/AddToPlaylist/AddToPlaylist.module.scss'

const NO_PLAYLISTS: readonly PlaylistSummary[] = []

type AddToPlaylistProps = {
  /** What is added, read once a playlist is picked: a track, or an album's tracks. */
  tracksOf: () => Promise<readonly Track[]>
  /** What is added, by name, for the empty message: "Create one and Chandelier goes straight in." */
  name: string
  /** Closes the sheet once a playlist is picked. */
  onDone: () => void
}

type NoticeOfProps = { error: Error | null; isSuccess: boolean }

/** What stands in for the list while there is none: why it could not be read, or that it is on its way. */
const noticeOf = ({ error, isSuccess }: NoticeOfProps): string | null => {
  if (error !== null) return error.message
  return isSuccess ? null : TRACK_MENU_COPY.loading
}

type PlaylistRowProps = {
  playlist: PlaylistSummary
  onAdd: (playlist: PickedPlaylist) => void
}

/** One of the listener's playlists: its art, its name and how many songs it holds. */
function PlaylistRow({ playlist, onAdd }: PlaylistRowProps) {
  const count = countsLineOf({ songs: playlist.trackCount })
  return (
    <li>
      <Pressable
        className={styles.row}
        label={TRACK_MENU_COPY.playlistRow({ name: playlist.name, count })}
        onPress={() => onAdd(playlist)}
      >
        <AlbumArt cover={null} radius={RADII.xs} size={SIZES.rowArt} />
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{playlist.name}</span>
          {count !== '' && <span className={styles.rowLine}>{count}</span>}
        </span>
      </Pressable>
    </li>
  )
}

/**
 * Add to playlist: New playlist, which makes one here and puts the tracks in it, then the
 * listener's own playlists, a press adding the tracks to the end of one. Either way the sheet
 * closes, and once the server has answered a toast says where they went, or why it refused.
 */
export function AddToPlaylist({ tracksOf, name, onDone }: AddToPlaylistProps) {
  const playlists = useQuery(queries.ownPlaylistsQuery)
  const [isNaming, setIsNaming] = useState(false)
  const list = playlists.data ?? NO_PLAYLISTS
  const add = useAddToPlaylist({ tracksOf, onDone })
  const notice = noticeOf({ error: playlists.error, isSuccess: playlists.isSuccess })
  const isEmpty = playlists.isSuccess && list.length === 0
  return (
    <div className={styles.body}>
      {!isNaming && (
        <Pressable className={styles.create} onPress={() => setIsNaming(true)}>
          <span className={styles.createTile}>
            <WrenIcon name={ICONS.plus} />
          </span>
          <span className={styles.createLabel}>{NEW_PLAYLIST_COPY.title}</span>
        </Pressable>
      )}
      {isNaming && <NewPlaylistForm onCreated={add} />}
      {notice !== null && <Notice text={notice} />}
      {isEmpty && (
        <EmptyState
          body={TRACK_MENU_COPY.noPlaylistsHint(name)}
          icon={ICONS.playlist}
          title={TRACK_MENU_COPY.noPlaylists}
        />
      )}
      {list.length > 0 && (
        <ul aria-label={TRACK_MENU_COPY.pickPlaylist(name)} className={styles.list}>
          {list.map((playlist) => (
            <PlaylistRow key={playlist.id} onAdd={add} playlist={playlist} />
          ))}
        </ul>
      )}
    </div>
  )
}
