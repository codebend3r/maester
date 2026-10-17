import { MEDIA_PROBE_BYTES, type MediaOrigin, type MediaOriginKind } from '@/contract'

export type OriginProbe = {
  origin: MediaOrigin
  firstByteMs: number
  bytesPerSecond: number
}

export const ORIGIN_KIND_RANK = { lan: 0, tailnet: 1, public: 2 } as const satisfies Record<
  MediaOriginKind,
  number
>

/** How much slower than the best an origin may be and still win on its kind. */
export const PREFERENCE_BAND = 0.2

/** Bytes per second for the whole probe body, first byte included, so latency and bandwidth both count. */
const scoreOf = ({ firstByteMs, bytesPerSecond }: OriginProbe): number => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return 0
  return MEDIA_PROBE_BYTES / (firstByteMs / 1000 + MEDIA_PROBE_BYTES / bytesPerSecond)
}

const compareProbes = (a: OriginProbe, b: OriginProbe): number =>
  ORIGIN_KIND_RANK[a.origin.kind] - ORIGIN_KIND_RANK[b.origin.kind] || a.firstByteMs - b.firstByteMs

/**
 * The origin to play from: among those within `PREFERENCE_BAND` of the best
 * score, the nearest kind, then the quickest first byte, then the first listed.
 */
export const pickOrigin = (probes: readonly OriginProbe[]): MediaOrigin | null => {
  const scored = probes.map((probe) => ({ probe, score: scoreOf(probe) }))
  const best = scored.reduce((top, { score }) => Math.max(top, score), 0)
  const [winner] = scored
    .filter(({ score }) => score >= (1 - PREFERENCE_BAND) * best)
    .map(({ probe }) => probe)
    .toSorted(compareProbes)
  return winner?.origin ?? null
}
