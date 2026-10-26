import { LOCKED_STATUS } from '@raven/core'
import type { OnVideoErrorData } from 'react-native-video'

/** The error domains AVPlayer names its HTTP failures in: the URL loader's and CoreMedia's. */
export const APPLE_ERROR_DOMAINS = {
  url: 'NSURLErrorDomain',
  coreMedia: 'CoreMediaErrorDomain',
} as const

/**
 * The URL loader's code AVPlayer failed an HLS stream with on the iOS 27 simulator once the
 * server answered its segments, then its video playlist, 404 for about eighty seconds of
 * retries: `NSURLErrorFileDoesNotExist`, "The requested URL was not found on this server."
 */
export const URL_ERROR_HTTP_CODES = { notFound: -1100 } as const

/**
 * The CoreMedia codes AVPlayer is known to fail an item with for an HTTP status. Apple documents
 * none of them; these are the codes its error log names "HTTP 404: File Not Found", "HTTP 403:
 * Forbidden" and "Authentication Error". The simulator answered the URL loader's code instead.
 */
export const CORE_MEDIA_HTTP_CODES = {
  notFound: -12938,
  forbidden: -12660,
  unauthorized: -12937,
} as const

/** ExoPlayer's `ERROR_CODE_IO_BAD_HTTP_STATUS` (2004), as `react-native-video` prefixes it with a 2. */
export const EXO_ERROR_CODES = { badHttpStatus: '22004' } as const

const HTTP_STATUSES = { unauthorized: 401, forbidden: 403, notFound: 404 } as const

/** The HTTP status each Apple code stands for, by its domain. */
const APPLE_HTTP_STATUSES: ReadonlyMap<string, ReadonlyMap<number, number>> = new Map([
  [
    APPLE_ERROR_DOMAINS.url,
    new Map<number, number>([[URL_ERROR_HTTP_CODES.notFound, HTTP_STATUSES.notFound]]),
  ],
  [
    APPLE_ERROR_DOMAINS.coreMedia,
    new Map<number, number>([
      [CORE_MEDIA_HTTP_CODES.notFound, HTTP_STATUSES.notFound],
      [CORE_MEDIA_HTTP_CODES.forbidden, HTTP_STATUSES.forbidden],
      [CORE_MEDIA_HTTP_CODES.unauthorized, HTTP_STATUSES.unauthorized],
    ]),
  ],
])

/**
 * The statuses the server lets go of a source with while it plays: 401 for a direct file whose
 * ticket's pass ended (its 12 hours, an account recheck, the pass cap, a restart), 403 for an
 * account it no longer lets in, 404 for an HLS session it ended or forgot (the capability's
 * deadline, an account recheck, the session cap, a restart) and 423 for a library locked again.
 * Each is the source's to hand out afresh, where the server says why if it will not.
 */
const LET_GO_STATUSES: ReadonlySet<number> = new Set([
  ...Object.values(HTTP_STATUSES),
  LOCKED_STATUS,
])

/** ExoPlayer names the response code in the cause it prints: `InvalidResponseCodeException: Response code: 404`. */
const EXO_RESPONSE_CODE = /InvalidResponseCodeException: Response code: (\d{3})/

const appleStatusOf = ({ domain, code }: OnVideoErrorData['error']): number | null =>
  domain === undefined || code === undefined
    ? null
    : (APPLE_HTTP_STATUSES.get(domain)?.get(code) ?? null)

const exoStatusOf = (error: OnVideoErrorData['error']): number | null => {
  if (error.errorCode !== EXO_ERROR_CODES.badHttpStatus) return null
  const code = error.errorStackTrace?.match(EXO_RESPONSE_CODE)?.[1] ?? null
  return code === null ? null : Number(code)
}

/**
 * The HTTP status a native player's failure carries, read from what each platform reports
 * through `react-native-video` (AVPlayer's CoreMedia code on Apple, ExoPlayer's cause on
 * Android), or null when it is no HTTP answer or the platform does not say.
 */
export const httpStatusOf = ({ error }: OnVideoErrorData): number | null =>
  exoStatusOf(error) ?? appleStatusOf(error)

/**
 * Whether the server let go of the source, rather than the way failing: the session ladder then
 * opens the same way again with a source handed out afresh, and steps down only for anything else.
 */
export const isServerDrop = (failure: OnVideoErrorData): boolean => {
  const status = httpStatusOf(failure)
  return status !== null && LET_GO_STATUSES.has(status)
}
