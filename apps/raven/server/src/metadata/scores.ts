import { Inject, Injectable, Logger } from '@nestjs/common'
import { METADATA_SERVICE_STATES } from '@raven/core'
import { errorMessage } from '@/errorMessage'
import { MdblistClient } from '@/metadata/mdblistClient'
import { OmdbClient } from '@/metadata/omdbClient'
import { ScoresRepository } from '@/metadata/scoresRepository'
import {
  SCORE_ANSWERS,
  SCORE_PROVIDERS,
  type ScoreAnswer,
  type ScoreProvider,
  type ScoreSource,
  type ScoreTitle,
} from '@/metadata/scoreSources'

const NAMES = { omdb: 'OMDb', mdblist: 'MDBList' } as const satisfies Record<ScoreProvider, string>

type ScoresAskProps = {
  source: ScoreSource
  itemId: number
  title: ScoreTitle
}

/**
 * IMDb, Rotten Tomatoes and Metacritic scores for a movie or show, while a
 * key and today's calls allow. MDBList is asked first when it can be, and
 * OMDb only for a title MDBList does not know; without MDBList, or once its
 * calls for the day are spent, OMDb is asked. Each provider's answer is kept
 * as its own, and the settler's also settles a Refresh's request for the
 * title. A call that fails is noted on its client and tried again on a
 * later sweep.
 */
@Injectable()
export class Scores {
  private readonly logger = new Logger(Scores.name)

  constructor(
    @Inject(ScoresRepository) private readonly scores: ScoresRepository,
    @Inject(OmdbClient) private readonly omdb: ScoreSource,
    @Inject(MdblistClient) private readonly mdblist: ScoreSource,
  ) {}

  /** The source asked first: MDBList when it can be asked, else OMDb when it can, else none. */
  primary(): ScoreSource | null {
    if (this.mdblist.enabled()) return this.mdblist
    if (this.omdb.enabled()) return this.omdb
    return null
  }

  /**
   * Asks the primary source for a title's scores, and OMDb as well when
   * MDBList does not know the title. False when no source could be asked or
   * the primary failed.
   */
  async fetch({ itemId, ...title }: ScoreTitle & { itemId: number }): Promise<boolean> {
    const primary = this.primary()
    if (primary == null) return false
    const answer = await this.ask({ source: primary, itemId, title })
    if (
      answer === SCORE_ANSWERS.unknown &&
      primary.provider === SCORE_PROVIDERS.mdblist &&
      this.omdb.enabled()
    ) {
      await this.ask({ source: this.omdb, itemId, title })
    }
    return answer != null
  }

  /**
   * The source whose answer settles a Refresh's request for a title: MDBList
   * while it has a usable key, its calls spent or not, as OMDb has no Rotten
   * Tomatoes or Metacritic score for a show; else OMDb while it has one;
   * else none, and TMDB's own score settles it.
   */
  settler(): ScoreSource | null {
    if (this.mdblist.hasUsableKey()) return this.mdblist
    if (this.omdb.hasUsableKey()) return this.omdb
    return null
  }

  /** OMDb while MDBList is the primary and OMDb can be asked too: for the titles MDBList does not know. */
  fallback(): ScoreSource | null {
    return this.primary() === this.mdblist && this.omdb.enabled() ? this.omdb : null
  }

  /** Asks OMDb alone, for a title MDBList does not know. False when OMDb failed. */
  async fetchFallback({ itemId, ...title }: ScoreTitle & { itemId: number }): Promise<boolean> {
    return (await this.ask({ source: this.omdb, itemId, title })) != null
  }

  /** The sources with a key whose calls for today are spent, which midnight UTC brings back. */
  spent(): ScoreSource[] {
    return [this.mdblist, this.omdb].filter(
      (source) => source.state() !== METADATA_SERVICE_STATES.off && source.remaining() === 0,
    )
  }

  /** What `source` answers, saved under its name; null when the call failed. */
  private async ask({ source, itemId, title }: ScoresAskProps): Promise<ScoreAnswer | null> {
    try {
      const answer = await source.lookUp(title)
      this.scores.saveScores({
        itemId,
        provider: source.provider,
        scores: answer === SCORE_ANSWERS.unknown ? [] : answer,
      })
      if (this.settler() === source) this.scores.clearRequest(itemId)
      return answer
    } catch (error) {
      this.logger.warn(
        `No ${NAMES[source.provider]} scores for ${title.type} ${title.tmdbId}: ${errorMessage(error)}`,
      )
      return null
    }
  }
}
