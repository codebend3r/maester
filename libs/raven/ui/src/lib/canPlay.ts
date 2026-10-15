import type { CanPlay } from '@raven/core'

const probe = typeof document === 'undefined' ? null : document.createElement('video')
const answers = new Map<string, boolean>()
const streamAnswers = new Map<string, boolean>()

/**
 * This browser's own answer, "maybe" and "probably" both counting as yes.
 * Cached per MIME type, since a library page asks about the same few
 * combinations hundreds of times.
 */
export const browserCanPlay: CanPlay = (mimeType) => {
  const known = answers.get(mimeType)
  if (known != null) return known
  const answer = !!probe && probe.canPlayType(mimeType) !== ''
  answers.set(mimeType, answer)
  return answer
}

/**
 * Whether this browser can play a converted stream of `mimeType` through
 * Media Source Extensions: managed ones on iOS, classic ones elsewhere. No
 * to everything where neither exists.
 */
export const browserCanStream: CanPlay = (mimeType) => {
  const known = streamAnswers.get(mimeType)
  if (known != null) return known
  const Source =
    typeof window === 'undefined' ? undefined : (window.ManagedMediaSource ?? window.MediaSource)
  const answer = !!Source && Source.isTypeSupported(mimeType)
  streamAnswers.set(mimeType, answer)
  return answer
}
