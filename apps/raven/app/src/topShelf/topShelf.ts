import type { PosterEntry } from '@raven/core'
import {
  TOP_SHELF_KINDS,
  TOP_SHELF_LAYOUTS,
  type TopShelf,
  deepLinkOf,
} from '@raven/top-shelf/contract'

import { APP_SCHEME } from '@/config/linkScheme'
import type { Pictures, ShelfCard } from '@/queries/cards'
import { CONTINUE_WATCHING, HOME_CONTINUE_COUNT, continueCard } from '@/queries/homeShelves'
import type { ShowArts } from '@/queries/showArt'
import { APP_ROUTES, ROUTE_TARGETS, type RouteTarget, hrefOf } from '@/routes'

/** What the Top Shelf says while nobody is signed in. */
export const TOP_SHELF_COPY = { signIn: 'Sign in to Raven' } as const

/** A route as the deep link the system opens it by. */
const linkTo = (target: RouteTarget): string =>
  deepLinkOf({ scheme: APP_SCHEME, ...hrefOf(target) })

/** Signed out: the invitation, which opens sign-in. */
export const SIGNED_OUT_SHELF: TopShelf = {
  kind: TOP_SHELF_KINDS.signedOut,
  title: TOP_SHELF_COPY.signIn,
  openUrl: deepLinkOf({ scheme: APP_SCHEME, pathname: APP_ROUTES.signIn, params: {} }),
}

/** The line under a slide's title: an episode's place and name, or a film's year, then what is left. */
const summaryOf = (card: ShelfCard): string | null => {
  const words = [
    card.episode?.mark ?? null,
    card.episode?.name ?? card.line,
    card.resume?.timeLeft ?? null,
  ].filter((word): word is string => !!word)
  return words.length === 0 ? null : words.join(' · ')
}

type ContinueShelfOfProps = Pictures & { entries: readonly PosterEntry[]; arts: ShowArts }

/**
 * Signed in: Continue watching as a carousel, the newest as many as Home shows, each on the
 * backdrop its card wears. Play resumes it where the server saved it; selecting it opens where
 * its card goes. A video with no picture is left off, since a slide is its picture.
 */
export const continueShelfOf = ({
  entries,
  arts,
  ...pictures
}: ContinueShelfOfProps): TopShelf => ({
  kind: TOP_SHELF_KINDS.titles,
  layout: TOP_SHELF_LAYOUTS.carousel,
  title: CONTINUE_WATCHING,
  items: entries.slice(0, HOME_CONTINUE_COUNT).flatMap((entry) => {
    const card = continueCard({ entry, arts, ...pictures })
    if (card.picture === null) return []
    return [
      {
        id: card.key,
        title: card.title,
        summary: summaryOf(card),
        picture: card.picture,
        playUrl: linkTo({ kind: ROUTE_TARGETS.play, mediaId: entry.media.id, at: 0 }),
        openUrl: linkTo(card.target),
      },
    ]
  }),
})
