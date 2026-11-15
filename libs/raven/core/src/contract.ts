/**
 * The API contract between the media server and every client. Anything a
 * client renders, or the server returns, is one of these shapes, so the web
 * app and a future native app agree on the wire format by construction.
 *
 * Each shape is written once, as the guard that checks it, and its type is
 * read off the guard. `response.json()` and a request body are both
 * `unknown` until one of these says otherwise, which is what lets every
 * client and the server skip casts entirely.
 */

export * from '@/contract/auth'
export * from '@/contract/binge'
export * from '@/contract/captions'
export * from '@/contract/deviceDownloads'
export * from '@/contract/dolbyVision'
export * from '@/contract/duplicates'
export * from '@/contract/home'
export * from '@/contract/ids'
export * from '@/contract/images'
export * from '@/contract/items'
export * from '@/contract/libraries'
export * from '@/contract/locks'
export * from '@/contract/lyrics'
export * from '@/contract/markers'
export * from '@/contract/scanControl'
export * from '@/contract/metadata'
export * from '@/contract/mixes'
export * from '@/contract/music'
export * from '@/contract/notifications'
export * from '@/contract/people'
export * from '@/contract/requests'
export * from '@/contract/upcoming'
export * from '@/contract/playHistory'
export * from '@/contract/playlists'
export * from '@/contract/remoteAccess'
export * from '@/contract/reports'
export * from '@/contract/sagas'
export * from '@/contract/scrobbling'
export * from '@/contract/server'
export * from '@/contract/sessions'
export * from '@/contract/settings'
export * from '@/contract/sorting'
export * from '@/contract/streaming'
export * from '@/contract/tracks'
export * from '@/contract/viewing'
// The HTTP vocabulary is the whole suite's, in `@shared/http`; raven's clients read the methods through core.
export { HTTP_METHODS } from '@shared/http'
