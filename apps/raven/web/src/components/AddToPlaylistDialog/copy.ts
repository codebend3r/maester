type AddedProps = { what: string; name: string }

type NotAddedProps = { name: string; why: string }

export const ADD_TO_PLAYLIST_COPY = {
  added: ({ what, name }: AddedProps) => `Added ${what} to ${name}`,
  notAdded: ({ name, why }: NotAddedProps) => `Could not add to ${name}: ${why}`,
  reading: 'Reading your playlists…',
  none: 'You have no playlists yet. Name one below to start it.',
  yourPlaylists: 'Your playlists',
  newPlaylist: 'New playlist',
  makeAndAdd: 'Make and add',
} as const
