import { toQueryString } from '@/query'
import { isNumber } from '@/schema'

export const PLAY_LINK_MAX_NEXT = 100

/** A server's id for a video: a whole number above 0 that fits a double exactly. */
export const isMediaId = (value: unknown): value is number =>
  isNumber(value) && Number.isSafeInteger(value) && value > 0

/** What a link asks the desktop to play: the server's origin, the title, where to start, and what plays after it. */
export type PlayRequest = { origin: string; mediaId: number; at: number; next: number[] }

const startOf = (at: number): number => {
  const seconds = isNumber(at) ? Math.max(0, Math.floor(at)) : 0
  return Number.isSafeInteger(seconds) ? seconds : 0
}

/** The link for a title; throws for a `mediaId` that is not one, and leaves out `next` ids that are not. */
export const playLinkFor = ({ origin, mediaId, at, next }: PlayRequest): string => {
  if (!isMediaId(mediaId)) throw new RangeError(`${mediaId} is not a media id`)
  const query = toQueryString({
    server: origin,
    media: String(mediaId),
    at: String(startOf(at)),
  })
  const queue = next.filter(isMediaId).slice(0, PLAY_LINK_MAX_NEXT)
  if (queue.length === 0) return `raven://play?${query}`
  return `raven://play?${query}&${toQueryString({ next: queue.join(',') })}`
}
