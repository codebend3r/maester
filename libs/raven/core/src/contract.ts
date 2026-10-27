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
export * from '@/contract/duplicates'
export * from '@/contract/home'
export * from '@/contract/images'
export * from '@/contract/items'
export * from '@/contract/libraries'
export * from '@/contract/locks'
export * from '@/contract/metadata'
export * from '@/contract/people'
export * from '@/contract/reports'
export * from '@/contract/sagas'
export * from '@/contract/server'
export * from '@/contract/settings'
export * from '@/contract/sorting'
export * from '@/contract/streaming'
export * from '@/contract/tracks'
export * from '@/contract/viewing'
