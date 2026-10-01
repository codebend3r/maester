import type { CanPlay } from '@weirwood/core'

const probe = typeof document === 'undefined' ? null : document.createElement('video')
const answers = new Map<string, boolean>()

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
