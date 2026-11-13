import {
  type MediaItem,
  WATCHED_STATES,
  type WatchedState,
  SHOW_SESSION,
  episodeCode,
} from '@raven/core'

import type { DownloadButton } from '@/downloads/downloadControl'
import type { Pictures } from '@/queries/cards'
import { type ItemLink, LINK_ICONS } from '@/queries/itemLinks'
import type { BingeToggle } from '@/queries/useBinge'
import type { ItemMarks } from '@/queries/useMarks'
import { canDownload } from '@/layouts'
import { type CheckState, ITEM_ACTIONS, type ItemAction } from '@/layouts/itemKit'
import { ROUTE_TARGETS, type RouteTarget } from '@/routes'
import { ITEM_COPY } from '@/screens/copy'
import { APP_ICONS } from '@/theme/icons'

/*
 * The actions an item's page offers, built from what the page knows: Play or Resume, from the
 * start, the next episode, the marks (favourite, watched, binge, download), Play all, Shuffle
 * and the item's links. Each is a plain `ItemAction` the layouts draw their own way.
 */

const ACTION_KEYS = {
  play: 'play',
  fromStart: 'fromStart',
  next: 'next',
  favourite: 'favourite',
  watched: 'watched',
  playAll: 'playAll',
  shuffle: 'shuffle',
  binge: 'binge',
  download: 'download',
} as const

/** A Watched toggle reads as ticked for all of it, half ticked for some, as the web's does. */
const WATCHED_CHECKS = {
  [WATCHED_STATES.unwatched]: false,
  [WATCHED_STATES.partly]: 'mixed',
  [WATCHED_STATES.watched]: true,
} as const satisfies Record<WatchedState, CheckState>

/** What a page's item is shown with: its pictures' headers, and where it leads. */
export type ItemContext = Pick<Pictures, 'headersFor'> & {
  onOpen: (target: RouteTarget) => void
  onBack: () => void
}

type PlayOfProps = {
  media: MediaItem
  label: string
  context: ItemContext
}

export const playOf = ({ media, label, context }: PlayOfProps): ItemAction => ({
  kind: ITEM_ACTIONS.play,
  key: ACTION_KEYS.play,
  icon: APP_ICONS.play,
  label,
  // Play alone is its icon; Resume shows the spot, and a show's Play the episode's code.
  text: label === ITEM_COPY.play ? null : label.replace(ITEM_COPY.playEpisode(''), ''),
  onPress: () =>
    context.onOpen({ kind: ROUTE_TARGETS.play, mediaId: media.id, at: media.position }),
})

type RewatchOfProps = { media: MediaItem; context: ItemContext }

/** Rewatch, in Play's place once all of a show or season is watched: its first episode, from the start. */
const rewatchOf = ({ media, context }: RewatchOfProps): ItemAction => ({
  ...playOf({ media, label: ITEM_COPY.rewatch, context }),
  onPress: () =>
    context.onOpen({ kind: ROUTE_TARGETS.play, mediaId: media.id, at: 0, isFromStart: true }),
})

type FromStartOfProps = { media: MediaItem; context: ItemContext }

/**
 * Play from the beginning, an icon beside Resume, for a video part watched; none for one not
 * started, whose Play starts at the beginning anyway.
 */
export const fromStartOf = ({ media, context }: FromStartOfProps): ItemAction[] =>
  media.position > 0
    ? [
        {
          kind: ITEM_ACTIONS.option,
          key: ACTION_KEYS.fromStart,
          icon: APP_ICONS.reset,
          label: ITEM_COPY.fromStart,
          text: null,
          onPress: () =>
            context.onOpen({
              kind: ROUTE_TARGETS.play,
              mediaId: media.id,
              at: 0,
              isFromStart: true,
            }),
        },
      ]
    : []

type FavouriteOfProps = {
  isOn: boolean
  onToggle: (isMarked: boolean) => void
}

export const favouriteOf = ({ isOn, onToggle }: FavouriteOfProps): ItemAction => ({
  kind: ITEM_ACTIONS.toggle,
  key: ACTION_KEYS.favourite,
  icon: APP_ICONS.heart,
  label: ITEM_COPY.favourite,
  text: null,
  isOn,
  isDisabled: false,
  onPress: () => onToggle(!isOn),
})

/** What a Watched mark says: what pressing it marks, and that it all is once it is. */
type WatchedWords = { mark: string; marked: string }

type WatchedOfProps = {
  state: WatchedState
  onToggle: () => void
  /** The words for what the mark covers: a video, a whole season, a whole show. */
  words: WatchedWords
}

/** Watched says what pressing it does until everything is, then that it is, beside its icon as the web's. */
export const watchedOf = ({ state, onToggle, words }: WatchedOfProps): ItemAction => {
  const label = state === WATCHED_STATES.watched ? words.marked : words.mark
  return {
    kind: ITEM_ACTIONS.toggle,
    key: ACTION_KEYS.watched,
    icon: APP_ICONS.check,
    label,
    text: label,
    isOn: WATCHED_CHECKS[state],
    isDisabled: false,
    onPress: onToggle,
  }
}

/** Binge's label: what pressing it does, that it is on, or, while the list is full, why it cannot be. */
type BingeLabelOfProps = Omit<BingeToggle, 'toggle'>

const bingeLabelOf = ({ isBinging, isFull }: BingeLabelOfProps): string => {
  if (isBinging) return ITEM_COPY.binging
  if (isFull) return `${ITEM_COPY.markBinging}. ${ITEM_COPY.bingeLimit}`
  return ITEM_COPY.markBinging
}

/**
 * Binge, a show's only, said as "Binge" or "Binging" beside its icon: on the account's binge
 * list, which holds `BINGE_LIMIT` shows. While the list is full of others it is drawn faint and
 * its press does nothing, as the web's does.
 */
const bingeOf = ({ isBinging, isFull, toggle }: BingeToggle): ItemAction => ({
  kind: ITEM_ACTIONS.toggle,
  key: ACTION_KEYS.binge,
  icon: APP_ICONS.popcorn,
  label: bingeLabelOf({ isBinging, isFull }),
  // In words beside the icon, so the remote finds it among the marks.
  text: isBinging ? ITEM_COPY.binging : ITEM_COPY.binge,
  isOn: isBinging,
  isDisabled: isFull,
  onPress: toggle,
})

/**
 * Download, a mark of its own: on once all of it is on the device, how far it has come while it
 * downloads, and faint where this device can take none of it. Only where the layouts download.
 */
export const downloadOf = ({ control, onPress }: DownloadButton): ItemAction[] =>
  canDownload
    ? [
        {
          kind: ITEM_ACTIONS.toggle,
          key: ACTION_KEYS.download,
          icon: control.icon,
          label: control.label,
          text: control.text,
          isOn: control.isOn,
          isDisabled: control.isDisabled,
          onPress,
        },
      ]
    : []

/** "Play S01E02" for the episode a show or season plays next, or plain Play without a number. */
const playNextLabel = (code: string | null): string =>
  code === null ? ITEM_COPY.play : ITEM_COPY.playEpisode(code)

type NextOfProps = { media: MediaItem; context: ItemContext }

/** "Next S01E03": the episode after this one in its show, played from where the server saved. */
export const nextOf = ({ media, context }: NextOfProps): ItemAction => {
  const code = media.item === null ? null : episodeCode(media.item)
  return {
    kind: ITEM_ACTIONS.play,
    key: ACTION_KEYS.next,
    icon: APP_ICONS.skipNext,
    label: code === null ? ITEM_COPY.nextEpisode : ITEM_COPY.nextCode(code),
    text: code,
    onPress: () => context.onOpen({ kind: ROUTE_TARGETS.play, mediaId: media.id, at: 0 }),
  }
}

type LinkActionOfProps = { link: ItemLink; context: ItemContext }

/**
 * A way up as a button: "Go to Severance", "Go to Season 1" from an episode, "View saga The
 * Lord of the Rings Collection" from a movie, each its icon with the name beside it.
 */
export const linkActionOf = ({ link, context }: LinkActionOfProps): ItemAction => ({
  kind: ITEM_ACTIONS.link,
  key: link.kind,
  icon: LINK_ICONS[link.kind],
  label: link.label,
  text: link.text,
  onPress: () => context.onOpen(link.target),
})

type MarksOfProps = {
  marks: ItemMarks
  /** What the Watched mark says it covers: the whole show, or the whole season. */
  words: WatchedWords
}

/**
 * A show's or a season's marks as actions: Favourite where the server says it can be one, then
 * Watched over every episode under it, saying which, and for a show Binge.
 */
export const marksOf = ({ marks, words }: MarksOfProps): ItemAction[] => [
  ...(marks.favourite === null ? [] : [favouriteOf(marks.favourite)]),
  watchedOf({ ...marks.watched, words }),
  ...(marks.binge === null ? [] : [bingeOf(marks.binge)]),
]

type PlayNextActionsOfProps = {
  next: MediaItem | null
  code: string | null
  first: MediaItem | null | undefined
  state: WatchedState
  context: ItemContext
}

/**
 * What a show or season plays: the episode that comes next, from where it was left, or, once
 * all of it is watched, Rewatch from its first episode.
 */
export const playNextActionsOf = ({
  next,
  code,
  first,
  state,
  context,
}: PlayNextActionsOfProps): ItemAction[] => {
  if (next !== null)
    return [
      playOf({ media: next, label: playNextLabel(code), context }),
      ...fromStartOf({ media: next, context }),
    ]
  if (state === WATCHED_STATES.watched && first != null)
    return [rewatchOf({ media: first, context })]
  return []
}

type WordedOptionOfProps = Pick<ItemAction, 'key' | 'icon' | 'label'> & {
  /** What the press does; null while there is nothing to press, which draws no option. */
  onPress: (() => void) | null
}

/** Another way to play that says its words beside its icon: Play all, Shuffle. */
const wordedOptionOf = ({ key, icon, label, onPress }: WordedOptionOfProps): ItemAction[] =>
  onPress === null ? [] : [{ kind: ITEM_ACTIONS.option, key, icon, label, text: label, onPress }]

type PlayAllOfProps = { first: MediaItem | null; context: ItemContext }

/**
 * Play all: the first episode, from the very beginning, in the show's session, so it carries on
 * across the seasons, specials last; none until the first episode is known.
 */
export const playAllOf = ({ first, context }: PlayAllOfProps): ItemAction[] =>
  wordedOptionOf({
    key: ACTION_KEYS.playAll,
    icon: APP_ICONS.play,
    label: ITEM_COPY.playAll,
    onPress:
      first === null
        ? null
        : () =>
            context.onOpen({
              kind: ROUTE_TARGETS.play,
              mediaId: first.id,
              at: 0,
              isFromStart: true,
              session: SHOW_SESSION,
            }),
  })

type ShuffleOfProps = { onShuffle: (() => void) | null }

/** Shuffle: a random episode of the whole show, each next random too; none without a show. */
export const shuffleOf = ({ onShuffle }: ShuffleOfProps): ItemAction[] =>
  wordedOptionOf({
    key: ACTION_KEYS.shuffle,
    icon: APP_ICONS.shuffle,
    label: ITEM_COPY.shuffle,
    onPress: onShuffle,
  })
