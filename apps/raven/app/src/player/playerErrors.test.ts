import { describe, expect, it } from 'bun:test'
import type { OnVideoErrorData } from 'react-native-video'

import {
  APPLE_ERROR_DOMAINS,
  CORE_MEDIA_HTTP_CODES,
  EXO_ERROR_CODES,
  URL_ERROR_HTTP_CODES,
  httpStatusOf,
  isServerDrop,
} from '@/player/playerErrors'
import { STATUSES } from '@/test/fixtureFetch'

const CORE_MEDIA = APPLE_ERROR_DOMAINS.coreMedia

/** Failures that are no HTTP answer: AVFoundation's own codes, and ExoPlayer's decoder failing to start. */
const OTHER_FAILURES = {
  avFoundationDomain: 'AVFoundationErrorDomain',
  cannotDecode: -11821,
  exoDecoderInit: '24001',
} as const
const AV_FOUNDATION = OTHER_FAILURES.avFoundationDomain

/** The statuses the server lets go of a source with, and two it fails one with. */
const { unauthorized, forbidden, notFound, conflict, locked, failed } = STATUSES

/** What AVPlayer reports through `react-native-video` on iOS and tvOS. */
const apple = (error: OnVideoErrorData['error']): OnVideoErrorData => ({ error, target: 12 })

/** What ExoPlayer reports through `react-native-video` on Android TV for an HTTP status. */
const exo = ({
  status,
  code = EXO_ERROR_CODES.badHttpStatus,
}: {
  status: number | null
  code?: string
}) => ({
  error: {
    errorString: 'ExoPlaybackException: ERROR_CODE_IO_BAD_HTTP_STATUS',
    errorException: 'androidx.media3.exoplayer.ExoPlaybackException: Source error',
    errorCode: code,
    errorStackTrace: [
      'androidx.media3.exoplayer.ExoPlaybackException: Source error',
      '\tat androidx.media3.exoplayer.ExoPlayerImplInternal.handleIoException(ExoPlayerImplInternal.java:736)',
      ...(status === null
        ? []
        : [
            `Caused by: androidx.media3.datasource.HttpDataSource$InvalidResponseCodeException: Response code: ${status}`,
            '\tat androidx.media3.datasource.DefaultHttpDataSource.open(DefaultHttpDataSource.java:412)',
          ]),
    ].join('\n'),
  },
})

/** What AVPlayer reported on the iOS 27 simulator once the server had forgotten its HLS session. */
const SESSION_GONE_ON_APPLE = apple({
  localizedRecoverySuggestion: '',
  code: URL_ERROR_HTTP_CODES.notFound,
  localizedFailureReason: '',
  domain: APPLE_ERROR_DOMAINS.url,
  localizedDescription: 'The requested URL was not found on this server.',
})

describe('httpStatusOf', () => {
  it('reads the 404 AVPlayer gave up on a forgotten HLS session with', () => {
    expect(httpStatusOf(SESSION_GONE_ON_APPLE)).toBe(notFound)
  })

  it("reads the HTTP status AVPlayer's CoreMedia codes stand for", () => {
    const { notFound: gone, forbidden: refused, unauthorized: expired } = CORE_MEDIA_HTTP_CODES
    expect(
      [gone, refused, expired].map((code) =>
        httpStatusOf(apple({ code, domain: CORE_MEDIA, localizedDescription: 'x' })),
      ),
    ).toEqual([notFound, forbidden, unauthorized])
  })

  it('reads the response code ExoPlayer gives as the cause of a bad HTTP status', () => {
    const statuses = [notFound, unauthorized, forbidden, locked]
    expect(statuses.map((status) => httpStatusOf(exo({ status })))).toEqual(statuses)
  })

  it('reads no status from a failure that is not an HTTP answer', () => {
    expect(
      httpStatusOf(
        apple({
          code: OTHER_FAILURES.cannotDecode,
          domain: AV_FOUNDATION,
          localizedDescription: 'Cannot Decode',
        }),
      ),
    ).toBeNull()
    expect(httpStatusOf(exo({ status: null, code: OTHER_FAILURES.exoDecoderInit }))).toBeNull()
    expect(httpStatusOf({ error: {} })).toBeNull()
  })
})

describe('isServerDrop', () => {
  it('counts a session the server forgot, a ticket past its life, a refusal and a relock as the server letting go', () => {
    const statuses = [notFound, unauthorized, forbidden, locked]
    expect(statuses.map((status) => isServerDrop(exo({ status })))).toEqual(
      statuses.map(() => true),
    )
    expect(isServerDrop(SESSION_GONE_ON_APPLE)).toBe(true)
    expect(isServerDrop(apple({ code: CORE_MEDIA_HTTP_CODES.notFound, domain: CORE_MEDIA }))).toBe(
      true,
    )
  })

  it('counts any other failure as the way failing, so the ladder steps down', () => {
    expect(isServerDrop(exo({ status: failed }))).toBe(false)
    expect(isServerDrop(exo({ status: conflict }))).toBe(false)
    expect(isServerDrop(apple({ code: OTHER_FAILURES.cannotDecode, domain: AV_FOUNDATION }))).toBe(
      false,
    )
    expect(
      isServerDrop(apple({ code: CORE_MEDIA_HTTP_CODES.notFound, domain: AV_FOUNDATION })),
    ).toBe(false)
    expect(isServerDrop({ error: {} })).toBe(false)
  })
})
