import { Inject, Injectable } from '@nestjs/common'
import type { MatchItemType } from '@raven/core'
import { type MatchFacts, TmdbClient, TmdbError } from '@/metadata/tmdbClient'

const DAY_MS = 24 * 60 * 60 * 1000
const MOST_KEPT = 500

/** Nothing for details TMDB could not give; any other error is a bug, and goes on. */
const unlessTmdbFailed = (error: unknown): null => {
  if (error instanceof TmdbError) return null
  throw error
}

/**
 * The details Fix match's confidence reads, kept in memory a day so a
 * search asked again costs TMDB nothing. The oldest goes past 500.
 */
@Injectable()
export class MatchFactsCache {
  private readonly kept = new Map<string, { facts: MatchFacts; at: number }>()

  constructor(@Inject(TmdbClient) private readonly tmdb: TmdbClient) {}

  /**
   * Each result's details, by TMDB id, read together: those that arrive
   * within `deadlineMs`. One TMDB cannot give is left out, and so is one
   * still on its way, which is kept when it lands, for the next search.
   */
  async read({
    type,
    tmdbIds,
    deadlineMs,
  }: {
    type: MatchItemType
    tmdbIds: readonly string[]
    deadlineMs: number
  }): Promise<Map<string, MatchFacts>> {
    const deadline = { stop: () => {} }
    const timeUp = new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), deadlineMs)
      deadline.stop = () => clearTimeout(timer)
    })
    try {
      const read = await Promise.all(
        tmdbIds.map(async (tmdbId) => {
          // The race handles a call that settles after the deadline, so its rejection never floats.
          const facts = await Promise.race([
            this.one({ type, tmdbId }).catch(unlessTmdbFailed),
            timeUp,
          ])
          return facts == null ? [] : [[tmdbId, facts] as const]
        }),
      )
      return new Map(read.flat())
    } finally {
      deadline.stop()
    }
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
