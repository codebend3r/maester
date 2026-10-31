export const PLAYLIST_PAGE_COPY = {
  noun: 'playlist',
  eyebrow: 'Playlist',
  sharedEyebrow: 'Shared playlist',
  shared: 'Shared',
  sharedHint: 'Every account on this server can play and copy it.',
  copy: 'Copy to my playlists',
  copying: 'Copying',
  rename: 'Rename',
  changeFailed: (message: string) => `Could not change the playlist: ${message}`,
  empty: (name: string) => `Nothing in ${name} yet. Add tracks from an album, or from Now playing.`,
  tracks: 'Tracks',
  renameTitle: 'Rename playlist',
  moveUp: (title: string) => `Move ${title} up`,
  takeOut: (title: string) => `Remove ${title} from the playlist`,
} as const

export const DELETE_PLAYLIST_COPY = {
  title: (name: string) => `Delete ${name}?`,
  hint: 'This removes the playlist for good. Its tracks stay in their libraries.',
  confirm: 'Delete playlist',
} as const
