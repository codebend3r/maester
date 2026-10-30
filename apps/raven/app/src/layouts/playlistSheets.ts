import { isPlaylistName } from '@raven/core'
import { ActionSheetIOS, Alert } from 'react-native'

import { CANCEL } from '@/layouts/gridKit'
import { MUSIC_COPY } from '@/layouts/copy'
import { PLAYLIST_PICKS, type PlaylistChoice, type PlaylistPick } from '@/layouts/musicKit'
import { themeNow } from '@/theme/useTheme'

type AskPlaylistNameProps = {
  title: string
  /** The name the field opens on: the playlist's own for a rename, empty for a new one. */
  initial: string
  submit: string
  onName: (name: string) => void
}

/**
 * Asks for a playlist's name in the system's prompt, light or dark as the theme is. A name of
 * nothing but spaces, or one too long, is not sent.
 */
export const askPlaylistName = ({ title, initial, submit, onName }: AskPlaylistNameProps) => {
  Alert.prompt(
    title,
    undefined,
    [
      { text: CANCEL, style: 'cancel' },
      {
        text: submit,
        onPress: (value) => {
          const name = value?.trim() ?? ''
          if (isPlaylistName(name)) onName(name)
        },
      },
    ],
    'plain-text',
    initial,
    undefined,
    { userInterfaceStyle: themeNow().tone },
  )
}

type OpenAddToPlaylistSheetProps = {
  /** What is being added, the sheet's title: "Add Airbag to a playlist". */
  title: string
  playlists: readonly PlaylistChoice[]
  onPick: (pick: PlaylistPick) => void
}

/**
 * The system's action sheet of the account's playlists, then New playlist, which asks for a
 * name before it adds.
 */
export const openAddToPlaylistSheet = ({
  title,
  playlists,
  onPick,
}: OpenAddToPlaylistSheetProps) => {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      options: [...playlists.map((playlist) => playlist.name), MUSIC_COPY.newPlaylist, CANCEL],
      cancelButtonIndex: playlists.length + 1,
      userInterfaceStyle: themeNow().tone,
    },
    (index) => {
      const chosen = playlists[index]
      if (chosen !== undefined) {
        onPick({ kind: PLAYLIST_PICKS.existing, playlistId: chosen.id, name: chosen.name })
        return
      }
      if (index !== playlists.length) return
      askPlaylistName({
        title: MUSIC_COPY.newPlaylist,
        initial: '',
        submit: MUSIC_COPY.create,
        onName: (name) => onPick({ kind: PLAYLIST_PICKS.fresh, name }),
      })
    },
  )
}

type ConfirmDeletePlaylistProps = { name: string; onDelete: () => void }

/** Asks before a playlist is deleted, in the system's alert; Delete is drawn as destructive. */
export const confirmDeletePlaylist = ({ name, onDelete }: ConfirmDeletePlaylistProps) => {
  Alert.alert(
    MUSIC_COPY.deletePlaylist(name),
    MUSIC_COPY.deleteNote,
    [
      { text: CANCEL, style: 'cancel' },
      { text: MUSIC_COPY.delete, style: 'destructive', onPress: onDelete },
    ],
    { userInterfaceStyle: themeNow().tone },
  )
}
