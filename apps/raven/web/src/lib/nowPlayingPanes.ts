/** The address parameter that names the pane Now Playing opens on. */
export const PANE_PARAM = 'show'

/** The panes beside the player: the queue, and the track's lyrics or an audiobook's chapters. */
export const PANES = {
  queue: 'queue',
  extras: 'extras',
} as const

export type Pane = (typeof PANES)[keyof typeof PANES]

/** What the panes are called, wherever one is named: the mini-player's links, the tabs, the lists. */
export const PANE_COPY = {
  upNext: 'Up next',
  lyrics: 'Lyrics',
  chapters: 'Chapters',
} as const

const isPane = (value: string | null): value is Pane =>
  Object.values<string | null>(PANES).includes(value)

/** The pane an address names, the queue when it names none. */
export const paneOf = (value: string | null): Pane => (isPane(value) ? value : PANES.queue)

type PaneLinkProps = { nowPlaying: string; pane: Pane }

/** Now Playing's address, opened on `pane`. */
export const paneLink = ({ nowPlaying, pane }: PaneLinkProps): string =>
  `${nowPlaying}?${PANE_PARAM}=${pane}`
