import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { ITEM_TYPES } from '@raven/core'
import { FolderReader } from '@/metadata/folderReader'
import { ItemPictures } from '@/metadata/itemPictures'
import { isLocal } from '@/metadata/localItems'
import { MatchFiles } from '@/metadata/matchFiles'
import { notFound } from '@/metadata/matchPass'
import { MetadataRepository, type StoredItem } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { OmdbScores } from '@/metadata/omdbScores'
import { PASS_CONCURRENCY, PassGuard } from '@/metadata/passGuard'
import { TmdbClient } from '@/metadata/tmdbClient'
import { mapWithConcurrency } from '@/scanner/concurrency'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Fetches items from TMDB again: one at a time when asked, and every day the
 * ones that have gone stale. An item TMDB no longer has is forgotten, and
 * its files go back to be matched again. Movies stored before raven kept
 * sagas and logos learn theirs in the same sweep.
 */
@Injectable()
export class ItemRefresher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ItemRefresher.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(MetadataService) private readonly service: MetadataService,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(MatchFiles) private readonly files: MatchFiles,
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(OmdbScores) private readonly scores: OmdbScores,
    @Inject(ItemPictures) private readonly pictures: ItemPictures,
  ) {}

  /** The sweep runs on the metadata queue at start, behind the first passes, and daily after. */
  onApplicationBootstrap(): void {
    if (!this.tmdb.enabled) return
    const sweep = () => this.service.schedule({ key: 'sweep', task: () => this.sweep() })
    sweep()
    this.timer = setInterval(sweep, DAY_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /**
   * Fetches an item again now: a movie or show, a show's seasons with it, a
   * season with its episodes, and for every one the pictures beside its
   * files read again. One TMDB no longer has goes, and its files go back to
   * pending, or to unmatched when a Fix match pointed there. False when it
   * went.
   */
  async refresh(itemId: number): Promise<boolean> {
    const item = this.metadata.get(itemId)
    if (!item) return false
    if (isLocal(item.tmdbId)) return true
    try {
      await this.fetch(item)
    } catch (error) {
      if (!notFound(error)) throw error
      this.files.forgetItem(itemId).forEach((libraryId) => this.service.enqueue(libraryId))
      return false
    }
    await this.pictures.syncLocal({
      itemIds: this.metadata.itemsUnder(itemId),
      folders: new FolderReader(this.files),
    })
    this.pictures.warmPoster(itemId)
    return true
  }

  private async fetch(item: StoredItem): Promise<void> {
    switch (item.type) {
      case ITEM_TYPES.movie:
      case ITEM_TYPES.show: {
        const fetched =
          item.type === ITEM_TYPES.movie
            ? await this.tmdb.movie(item.tmdbId)
            : await this.tmdb.show(item.tmdbId)
        this.metadata.save({ item: fetched })
        if (item.type === ITEM_TYPES.show) await this.refreshSeasons(item.id)
        await this.scores.fetch({ itemId: item.id, imdbId: fetched.imdbId })
        return
      }
      case ITEM_TYPES.season:
        await this.refreshSeason(item)
        return
      case ITEM_TYPES.episode: {
        const season = item.parentId == null ? null : this.metadata.get(item.parentId)
        if (season) await this.refreshSeason(season)
        return
      }
      default: {
        const unknown: never = item.type
        throw new Error(`Cannot refresh an item of type ${String(unknown)}`)
      }
    }
  }

  private async refreshSeasons(showId: number): Promise<void> {
    const seasons = this.metadata.childIds(showId).flatMap((id) => this.metadata.get(id) ?? [])
    await seasons.reduce<Promise<void>>(
      (previous, season) => previous.then(() => this.refreshSeason(season)),
      Promise.resolve(),
    )
  }

  /** Fetches one season again; a season TMDB has dropped, or a made-up one, is left as it is. */
  private async refreshSeason(season: StoredItem): Promise<void> {
    if (season.parentId == null || season.number == null || isLocal(season.tmdbId)) return
    const show = this.metadata.get(season.parentId)
    if (!show) return
    const fetched = await this.tmdb
      .season({ showTmdbId: show.tmdbId, number: season.number })
      .catch((error: unknown) => {
        if (notFound(error)) return null
        throw error
      })
    if (fetched) this.metadata.saveSeason({ showId: show.id, number: season.number, ...fetched })
  }

  /**
   * Refreshes movies and shows fetched more than 30 days ago, or more than 7
   * days ago when they came out in the last 90 days or the show still airs.
   * One that fails is logged and the rest go on; TMDB going away stops it.
   */
  async sweep(): Promise<void> {
    if (!this.tmdb.enabled) return
    const now = Date.now()
    const window = {
      before: new Date(now - 30 * DAY_MS).toISOString(),
      recentBefore: new Date(now - 7 * DAY_MS).toISOString(),
      releasedAfter: new Date(now - 90 * DAY_MS).toISOString().slice(0, 10),
    }
    const stale = [
      ...this.metadata.stale({ type: ITEM_TYPES.movie, ...window }),
      ...this.metadata.stale({ type: ITEM_TYPES.show, ...window }),
    ]
    const guard = new PassGuard({
      logger: this.logger,
      failed: 'Could not refresh',
      stopped: 'Refreshing stopped for now',
    })
    await mapWithConcurrency({
      items: stale,
      limit: PASS_CONCURRENCY,
      fn: ({ id }) => guard.run(() => this.refresh(id)),
    })
    guard.reportStop()
    await this.fillMovieExtras()
    await this.scores.fillDue()
    await this.pictures.clearUp()
  }

  /**
   * Asks TMDB for the saga and logo of each movie stored before raven kept
   * them: the movie with its pictures, one call each, so no credits or
   * scores are fetched again. One TMDB no longer has is noted as in no saga
   * and with no logo; the sweep that refreshes it forgets it.
   */
  private async fillMovieExtras(): Promise<void> {
    const guard = new PassGuard({
      logger: this.logger,
      failed: "Could not read a movie's saga and logo",
      stopped: 'Reading sagas and logos stopped for now',
    })
    await mapWithConcurrency({
      items: this.metadata.extrasUnchecked(),
      limit: PASS_CONCURRENCY,
      fn: ({ id, tmdbId }) =>
        guard.run(async () => {
          const extras = await this.tmdb.movieExtras(tmdbId).catch((error: unknown) => {
            if (notFound(error)) return { saga: null, logo: null }
            throw error
          })
          this.metadata.saveMovieExtras({ itemId: id, ...extras })
        }),
    })
    guard.reportStop()
  }
}
