import { Inject, Injectable } from '@nestjs/common'
import type { MatchItemType } from '@raven/core'
import { type MatchFacts, TmdbClient } from '@/metadata/tmdbClient'

const DAY_MS = 24 * 60 * 60 * 1000
const MOST_KEPT = 500

/**
 * The details Fix match's confidence reads, kept in memory a day so a
 * search asked again costs TMDB nothing. The oldest goes past 500.
 */
@Injectable()
export class MatchFactsCache {
  private readonly kept = new Map<string, { facts: MatchFacts; at: number }>()

  constructor(@Inject(TmdbClient) private readonly tmdb: TmdbClient) {}

  /** Each result's details, by TMDB id, read together; one TMDB cannot give is left out. */
  async read({
    type,
    tmdbIds,
  }: {
    type: MatchItemType
    tmdbIds: readonly string[]
  }): Promise<Map<string, MatchFacts>> {
    const read = await Promise.all(
      tmdbIds.map(async (tmdbId) => {
        const facts = await this.one({ type, tmdbId }).catch(() => null)
        return facts == null ? [] : [[tmdbId, facts] as const]
      }),
    )
    return new Map(read.flat())
  }

  private async one({
    type,
    tmdbId,
  }: {
    type: MatchItemType
    tmdbId: string
  }): Promise<MatchFacts> {
    const key = `${type}:${tmdbId}`
    const kept = this.kept.get(key)
    if (kept != null && Date.now() - kept.at < DAY_MS) return kept.facts
    const facts = await this.tmdb.matchFacts({ type, tmdbId })
    this.kept.delete(key)
    this.kept.set(key, { facts, at: Date.now() })
    const [oldest] = this.kept.keys()
    if (this.kept.size > MOST_KEPT && oldest != null) this.kept.delete(oldest)
    return facts
  }
}
