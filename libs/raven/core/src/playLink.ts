import { toQueryString } from '@/query'
import { type Infer, isNumber, matching, object, oneOf, union } from '@/schema'

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

export const DOWNLOAD_TARGET_KINDS = { media: 'media', item: 'item', saga: 'saga' } as const

const isCollectionId = matching(/^[1-9]\d{0,15}$/u)

/** What a download link asks the desktop to keep: one file, one title, or one collection of a library. */
export const isDownloadTarget = union(
  object({ kind: oneOf([DOWNLOAD_TARGET_KINDS.media]), mediaId: isMediaId }),
  object({ kind: oneOf([DOWNLOAD_TARGET_KINDS.item]), itemId: isMediaId }),
  object({
    kind: oneOf([DOWNLOAD_TARGET_KINDS.saga]),
    libraryId: isMediaId,
    tmdbId: isCollectionId,
  }),
)

export type DownloadTarget = Infer<typeof isDownloadTarget>

export type DownloadRequest = { origin: string; target: DownloadTarget }

/** The link for a download; throws for an id that is not one. */
export const downloadLinkFor = ({ origin, target }: DownloadRequest): string => {
  switch (target.kind) {
    case DOWNLOAD_TARGET_KINDS.media: {
      if (!isMediaId(target.mediaId)) throw new RangeError(`${target.mediaId} is not a media id`)
      return `raven://download?${toQueryString({ server: origin, media: String(target.mediaId) })}`
    }
    case DOWNLOAD_TARGET_KINDS.item: {
      if (!isMediaId(target.itemId)) throw new RangeError(`${target.itemId} is not an item id`)
      return `raven://download?${toQueryString({ server: origin, item: String(target.itemId) })}`
    }
    case DOWNLOAD_TARGET_KINDS.saga: {
      if (!isMediaId(target.libraryId)) {
        throw new RangeError(`${target.libraryId} is not a library id`)
      }
      if (!isCollectionId(target.tmdbId)) {
        throw new RangeError(`${target.tmdbId} is not a collection id`)
      }
      const saga = `${target.libraryId}:${target.tmdbId}`
      return `raven://download?${toQueryString({ server: origin, saga })}`
    }
    default: {
      const unreachable: never = target
      throw new RangeError(`unknown download target ${JSON.stringify(unreachable)}`)
    }
  }
}
