import { type MediaItem, SESSION_KINDS, type ViewingSession } from '@/contract'
import { type WatchLink, watchLink } from '@/itemLinks'

/** The session's videos around the one playing: those before it, oldest first, and those after. */
export type SessionOrder = { before: readonly MediaItem[]; after: readonly MediaItem[] }

type SessionOrderOfProps = {
  media: MediaItem
  session: ViewingSession
  /** What the link says played before this one, for a session with no order of its own. */
  played: readonly MediaItem[]
  /** A queue's videos after this one. */
  upNext: readonly MediaItem[]
  /** The session's videos in its own order (a season's episodes, a saga's films); null while unknown or with none. */
  ordered: readonly MediaItem[] | null
  /** What the server says plays next; null with nothing, or for a queue. */
  found: MediaItem | null
}

type IsSameTitleProps = { one: MediaItem; other: MediaItem }

/** Whether two files play the same title: the same file, or two versions of one episode or film. */
const isSameTitle = ({ one, other }: IsSameTitleProps): boolean =>
  one.id === other.id || (one.item != null && other.item != null && one.item.id === other.item.id)

/**
 * What surrounds `media` in its session. A queue is what its link carries; a shuffle with no end
 * is what was played and the one episode the server drew; anything else is the session's own
 * order, and where that is not known, only what the server says is next.
 */
export const sessionOrderOf = ({
  media,
  session,
  played,
  upNext,
  ordered,
  found,
}: SessionOrderOfProps): SessionOrder => {
  if (session.kind === SESSION_KINDS.queue) return { before: played, after: upNext }
  const drawn = found === null ? [] : [found]
  if (session.kind === SESSION_KINDS.shuffle) return { before: played, after: drawn }
  const at = ordered?.findIndex((each) => isSameTitle({ one: each, other: media })) ?? -1
  if (ordered == null || at < 0) return { before: [], after: drawn }
  const after = ordered.slice(at + 1)
  // A show rolls on past its season's last episode, which the season's own list does not say.
  return { before: ordered.slice(0, at), after: after.length > 0 ? after : drawn }
}

/** The sessions whose order rides in the link, since no server keeps it. */
const CARRIED: ReadonlySet<ViewingSession['kind']> = new Set([
  SESSION_KINDS.queue,
  SESSION_KINDS.shuffle,
])

/**
 * Whether `session` has no order but the one its links carry: a queue a shuffle dealt, or a
 * shuffle with no end. Its links remember what played before, so Previous can go back.
 */
export const carriesItsOrder = (session: ViewingSession): boolean => CARRIED.has(session.kind)

type QueueStopsOfProps = {
  media: MediaItem
  session: ViewingSession
  order: SessionOrder
  /** The session a queue was dealt from inside the player; null for any other. */
  shuffledFrom: ViewingSession | null
}

/** A video of the queue and the link that plays it in this session. */
export type QueueStop = { media: MediaItem; link: WatchLink; isCurrent: boolean }

/**
 * Every video of the session in the order it plays, each with the link that plays it there: a
 * queue's link carries what comes after it, and a queue's or a shuffle's what came before.
 */
export const queueStopsOf = ({
  media,
  session,
  order,
  shuffledFrom,
}: QueueStopsOfProps): QueueStop[] => {
  const all = [...order.before, media, ...order.after]
  return all.map((each, at) => ({
    media: each,
    isCurrent: at === order.before.length,
    link: watchLink({
      media: each,
      session,
      upNext: session.kind === SESSION_KINDS.queue ? all.slice(at + 1) : [],
      played: carriesItsOrder(session) ? all.slice(0, at) : [],
      shuffledFrom,
    }),
  }))
}
