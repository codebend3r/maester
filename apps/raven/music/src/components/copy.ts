type TitledProps = { title: string; artists: string }

export const DETAIL_COPY = {
  back: 'Back',
} as const

export const CONTROLS_COPY = {
  play: 'Play',
  shuffle: 'Shuffle',
  favourite: 'Favourite',
} as const

export const ALBUM_TILE_COPY = {
  /** An album as it is read out: "OK Computer, Radiohead". */
  label: ({ title, artists }: TitledProps) => `${title}, ${artists}`,
} as const

export const TRACK_ROW_COPY = {
  more: (title: string) => `More for ${title}`,
} as const

export const TRACK_MENU_COPY = {
  playNext: 'Play next',
  addToQueue: 'Add to queue',
  addToPlaylist: 'Add to playlist',
  pickPlaylist: (title: string) => `Add ${title} to a playlist`,
  added: (name: string) => `Added to ${name}.`,
  noPlaylists: 'You have no playlists yet.',
  loading: 'Loading your playlists',
  cancel: 'Cancel',
  done: 'Done',
  close: 'Close the menu',
} as const

export const BAR_COPY = {
  play: 'Play',
  pause: 'Pause',
  next: 'Next',
  /** What the bar is called aloud: what it opens, and the track it shows. */
  open: ({ title, artists }: TitledProps) => `Now Playing: ${title}, ${artists}`,
} as const
