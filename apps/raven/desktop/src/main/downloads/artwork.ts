import type { DownloadFacts } from '@raven/core'

type FactsBeforeProps = { createdAt: number }

/** What a download confirmed before its facts were kept can still say: when it was added. */
export const factsBefore = ({ createdAt }: FactsBeforeProps): DownloadFacts => {
  const at = new Date(createdAt).toISOString()
  return { year: null, score: null, bitrate: null, pixels: null, addedAt: at, changedAt: at }
}
