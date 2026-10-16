import { Body, Controller, Headers, HttpCode, Inject, Put } from '@nestjs/common'
import { isWatchedChange, MAX_WATCH_TARGETS } from '@raven/core'
import { ForViewers } from '@/admin/adminGuard'
import { LockService } from '@/lock/lockService'
import { WatchedCards } from '@/media/watchedCards'
import { WatchedRepository } from '@/media/watchedRepository'
import { parseBody } from '@/parseBody'

/**
 * Marking cuts across libraries, so it hangs off its own root, like
 * favourites. It takes no `:id`, so the lock has nothing to hold it by:
 * targets in libraries this browser may not see are skipped, and the answer
 * is the same either way.
 */
@Controller('api/watched')
export class WatchedController {
  constructor(
    @Inject(LockService) private readonly lock: LockService,
    @Inject(WatchedCards) private readonly cards: WatchedCards,
    @Inject(WatchedRepository) private readonly watched: WatchedRepository,
  ) {}

  /** Marks every target watched or unwatched; see `WatchedRepository.set` for what that does. */
  @ForViewers()
  @Put()
  @HttpCode(204)
  set(@Body() body: unknown, @Headers('cookie') cookie: string | undefined): void {
    const change = parseBody({
      guard: isWatchedChange,
      body,
      message: `Send { watched, targets }: 1 to ${MAX_WATCH_TARGETS} targets, each a file or an item.`,
    })
    this.watched.set({
      cards: this.cards.resolve({
        targets: change.targets,
        viewer: this.lock.viewer({ cookie }),
      }),
      watched: change.watched,
      at: new Date(),
    })
  }
}
