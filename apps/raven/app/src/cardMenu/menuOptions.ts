import { WATCHED_STATES, type WatchedState } from '@raven/core'

import {
  DOWNLOAD_ACTIONS,
  type DownloadAction,
  type DownloadButton,
} from '@/downloads/downloadControl'
import { type ItemLink, LINK_KINDS } from '@/queries/itemLinks'
import type { BingeToggle } from '@/queries/useBinge'

/** The words of the menu a held select opens over a card on a TV, or a long press under the thumb. */
export const CARD_MENU_COPY = {
  markWatched: 'Mark watched',
  markUnwatched: 'Mark unwatched',
  addFavourite: 'Add to favourites',
  removeFavourite: 'Remove from favourites',
  addBinge: 'Add to binge',
  removeBinge: 'Remove from binge',
  /** Under a faint Add to binge while three other shows fill the list. */
  bingeFull: 'Three shows are already binging. Remove one to make room.',
  cancelDownload: 'Cancel download',
  retryDownload: 'Retry download',
  removeDownload: 'Remove download',
  reading: 'Reading the title',
  failed: 'The title could not be read.',
} as const

/** What a line of the menu does: a mark, the download, or one of the ways up. */
const CARD_MENU_ACTIONS = {
  watched: 'watched',
  favourite: 'favourite',
  binge: 'binge',
  download: 'download',
  ...LINK_KINDS,
} as const

type CardMenuAction = (typeof CARD_MENU_ACTIONS)[keyof typeof CARD_MENU_ACTIONS]

/** One line of a card's menu: what it does, and what blocks it now, if anything does. */
export type CardMenuOption = {
  key: CardMenuAction
  label: string
  /** What blocks the option now, drawn under it faint; null while it can be taken. */
  blockedBy: string | null
  onPress: () => void
}

/** Whether an option is drawn faint and its press does nothing. */
export const isOptionBlocked = (option: CardMenuOption): boolean => option.blockedBy !== null

type WatchedOptionOfProps = { state: WatchedState; onToggle: () => void }

/** Mark watched, or Mark unwatched once all of it is. */
export const watchedOptionOf = ({ state, onToggle }: WatchedOptionOfProps): CardMenuOption => ({
  key: CARD_MENU_ACTIONS.watched,
  label:
    state === WATCHED_STATES.watched ? CARD_MENU_COPY.markUnwatched : CARD_MENU_COPY.markWatched,
  blockedBy: null,
  onPress: onToggle,
})

type FavouriteOptionOfProps = { isOn: boolean; onToggle: (isMarked: boolean) => void }

/** Add to favourites, or Remove from favourites while it is one. */
export const favouriteOptionOf = ({ isOn, onToggle }: FavouriteOptionOfProps): CardMenuOption => ({
  key: CARD_MENU_ACTIONS.favourite,
  label: isOn ? CARD_MENU_COPY.removeFavourite : CARD_MENU_COPY.addFavourite,
  blockedBy: null,
  onPress: () => onToggle(!isOn),
})

/**
 * Add to binge, or Remove from binge while the show is on the list; while three other shows
 * fill the list it says why instead, and its press does nothing, as the show page's Binge does.
 */
export const bingeOptionOf = ({ isBinging, isFull, toggle }: BingeToggle): CardMenuOption => ({
  key: CARD_MENU_ACTIONS.binge,
  label: isBinging ? CARD_MENU_COPY.removeBinge : CARD_MENU_COPY.addBinge,
  blockedBy: isFull ? CARD_MENU_COPY.bingeFull : null,
  onPress: toggle,
})

/** The download line's words by what pressing it does; none while there is nothing to press. */
const DOWNLOAD_LABELS = {
  [DOWNLOAD_ACTIONS.download]: null,
  [DOWNLOAD_ACTIONS.cancel]: CARD_MENU_COPY.cancelDownload,
  [DOWNLOAD_ACTIONS.retry]: CARD_MENU_COPY.retryDownload,
  [DOWNLOAD_ACTIONS.remove]: CARD_MENU_COPY.removeDownload,
  [DOWNLOAD_ACTIONS.none]: null,
} as const satisfies Record<DownloadAction, string | null>

/**
 * The download line, from the same button the item page draws: Download (said as the page's
 * Download says it), Cancel download while it is on its way, Retry download once it failed,
 * Remove download once it is on the device. A button that can do nothing now but says why (this
 * device can take none of it; some of a group still downloading) is a faint Download with the
 * why under it, and one with nothing to say is no line at all.
 */
export const downloadOptionOf = ({ control, onPress }: DownloadButton): CardMenuOption[] => {
  if (control.action === DOWNLOAD_ACTIONS.none && !control.isDisabled) return []
  const said = DOWNLOAD_LABELS[control.action]
  // Download names what it downloads, as the page's does; a faint one keeps to the word, the why under it.
  const label = control.isDisabled ? control.text : control.label
  return [
    {
      key: CARD_MENU_ACTIONS.download,
      label: said ?? label,
      blockedBy: control.isDisabled ? control.label : null,
      onPress,
    },
  ]
}

type LinkOptionOfProps = { link: ItemLink; onOpen: (link: ItemLink) => void }

/** A way up from the video: Go to its show, Go to its season, or View saga for a movie in one. */
export const linkOptionOf = ({ link, onOpen }: LinkOptionOfProps): CardMenuOption => ({
  key: CARD_MENU_ACTIONS[link.kind],
  label: link.label,
  blockedBy: null,
  onPress: () => onOpen(link),
})

/** What the menu says while its title is read, or once the read failed. */
export const readingNoteOf = (isFailed: boolean): string =>
  isFailed ? CARD_MENU_COPY.failed : CARD_MENU_COPY.reading
