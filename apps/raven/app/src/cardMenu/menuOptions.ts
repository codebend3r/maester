import { WATCHED_STATES, type WatchedState } from '@raven/core'

import type { BingeToggle } from '@/queries/useBinge'

/** The words of the menu a held select opens over a card on a TV. */
export const CARD_MENU_COPY = {
  markWatched: 'Mark watched',
  markUnwatched: 'Mark unwatched',
  addFavourite: 'Add to favourites',
  removeFavourite: 'Remove from favourites',
  addBinge: 'Add to binge',
  removeBinge: 'Remove from binge',
  /** Under a faint Add to binge while three other shows fill the list. */
  bingeFull: 'Three shows are already binging. Remove one to make room.',
  reading: 'Reading the title',
  failed: 'The title could not be read.',
} as const

/** What a line of the menu does. */
const CARD_MENU_ACTIONS = {
  watched: 'watched',
  favourite: 'favourite',
  binge: 'binge',
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

/** What the menu says while its title is read, or once the read failed. */
export const readingNoteOf = (isFailed: boolean): string =>
  isFailed ? CARD_MENU_COPY.failed : CARD_MENU_COPY.reading
