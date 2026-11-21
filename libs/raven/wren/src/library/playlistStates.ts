/** Whether the playlists' list says why it is empty, or offers the first playlist. */
export const PLAYLIST_STATES = { notice: 'notice', empty: 'empty' } as const

export type PlaylistState = (typeof PLAYLIST_STATES)[keyof typeof PLAYLIST_STATES]

type PlaylistsStateOfProps = { isSuccess: boolean }

/** What an empty list of playlists shows: the offer of a first one once it is read, else where the read stands. */
export const playlistsStateOf = ({ isSuccess }: PlaylistsStateOfProps): PlaylistState =>
  isSuccess ? PLAYLIST_STATES.empty : PLAYLIST_STATES.notice
