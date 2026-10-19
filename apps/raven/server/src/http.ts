import { AUTH_HEADERS } from '@raven/core'

/** Header names raven uses beyond `@shared/server`'s `HEADERS`, in lower case as Node hands incoming ones over. */
export const RAVEN_HEADERS = {
  acceptRanges: 'accept-ranges',
  authorization: AUTH_HEADERS.authorization,
  cookie: AUTH_HEADERS.cookie,
  forwardedFor: 'x-forwarded-for',
  retryAfter: 'retry-after',
  userAgent: 'user-agent',
} as const

/** Content types raven sends or reads beyond `@shared/server`'s `CONTENT_TYPES`. */
export const RAVEN_CONTENT_TYPES = {
  anyImage: 'image/*',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  /** An HLS media segment of fragmented MP4; its init segment goes as `mp4`. */
  segment: 'video/iso.segment',
} as const

/**
 * `Cache-Control` values beyond `@shared/server`'s `CACHE_POLICIES`. What
 * depends on the browser's cookies is `private` or `no-store`, never
 * `public`, or Netlify's CDN hands it to everyone.
 */
export const RAVEN_CACHE_POLICIES = {
  privateImmutable: 'private, max-age=31536000, immutable',
  privateMinute: 'private, max-age=60',
  privateFiveMinutes: 'private, max-age=300',
  privateRevalidate: 'private, max-age=0, must-revalidate',
} as const
