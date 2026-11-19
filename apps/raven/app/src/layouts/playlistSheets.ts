import { isPlaylistName } from '@raven/core'
import { Alert } from 'react-native'

import { CANCEL } from '@/layouts/gridKit'
import { MUSIC_COPY } from '@/layouts/copy'
import { PLAYLIST_PICKS, type PlaylistChoice, type PlaylistPick } from '@/layouts/musicKit'
import { askText, showChoice } from '@/layouts/touchSheets'
import { themeNow } from '@/theme/useTheme'

type AskPlaylistNameProps = {
  title: string
  /** The name the field opens on: the playlist's own for a rename, empty for a new one. */
  initial: string
  submit: string
  onName: (name: string) => void
}

/**
 * Asks for a playlist's name in this device's prompt, light or dark as the theme is. A name of
 * nothing but spaces, or one too long, is not sent.
 */
export const askPlaylistName = ({ title, initial, submit, onName }: AskPlaylistNameProps) =>
  askText({
    title,
    initial,
    submit,
    onSubmit: (value) => {
      const name = value.trim()
      if (isPlaylistName(name)) onName(name)
    },
  })

/** The sheet's last line, New playlist, which no playlist's id can be. */
const NEW_PLAYLIST_KEY = 'new-playlist'

type OpenAddToPlaylistSheetProps = {
  /** What is being added, the sheet's title: "Add Airbag to a playlist". */
  title: string
  playlists: readonly PlaylistChoice[]
  onPick: (pick: PlaylistPick) => void
}

/**
 * This device's sheet of the account's playlists, then New playlist, which asks for a
 * name before it adds.
 */
export const openAddToPlaylistSheet = ({ title, playlists, onPick }: OpenAddToPlaylistSheetProps) =>
  showChoice({
    title,
    message: null,
    options: [
      ...playlists.map((playlist) => ({
        key: String(playlist.id),
        label: playlist.name,
        isDestructive: false,
        onPress: () =>
          onPick({ kind: PLAYLIST_PICKS.existing, playlistId: playlist.id, name: playlist.name }),
      })),
      {
        key: NEW_PLAYLIST_KEY,
        label: MUSIC_COPY.newPlaylist,
        isDestructive: false,
        onPress: () =>
          askPlaylistName({
            title: MUSIC_COPY.newPlaylist,
            initial: '',
            submit: MUSIC_COPY.create,
            onName: (name) => onPick({ kind: PLAYLIST_PICKS.fresh, name }),
          }),
      },
    ],
    isOverPicture: false,
    anchor: null,
  })

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
