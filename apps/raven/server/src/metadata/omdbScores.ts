import { Inject, Injectable, Logger } from '@nestjs/common'
import { errorMessage } from '@/errorMessage'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { OmdbClient } from '@/metadata/omdbClient'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * IMDb, Rotten Tomatoes and Metacritic scores from OMDb, for a movie or show
 * with an IMDb id, while the key and today's calls allow. A call that fails
 * is noted on the client and tried again another day.
 */
@Injectable()
export class OmdbScores {
  private readonly logger = new Logger(OmdbScores.name)

  constructor(
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(OmdbClient) private readonly omdb: OmdbClient,
  ) {}

  async fetch({ itemId, imdbId }: { itemId: number; imdbId: string | null }): Promise<void> {
    if (imdbId == null || !this.omdb.enabled) return
    try {
      this.metadata.saveScores({ itemId, scores: await this.omdb.ratings(imdbId) })
    } catch (error) {
      this.logger.warn(`No OMDb scores for ${imdbId}: ${errorMessage(error)}`)
    }
  }

  /** Items whose OMDb scores are missing or a month old, as far as today's calls go. */
  async fillDue(): Promise<void> {
    if (!this.omdb.enabled) return
    const due = this.metadata.needingScores({
      before: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      limit: this.omdb.remaining(),
    })
    await due.reduce(
      (previous, item) =>
        previous.then(() =>
          this.omdb.enabled ? this.fetch({ itemId: item.id, imdbId: item.imdbId }) : undefined,
        ),
      Promise.resolve(),
    )
  }
}
