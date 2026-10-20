import { Body, Controller, Req, HttpCode, Inject, Put } from '@nestjs/common'
import { isWatchedChange, MAX_WATCH_TARGETS } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { LockService } from '@/lock/lockService'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { WatchedCards } from '@/media/watchedCards'
import { WatchedRepository } from '@/media/watchedRepository'
import { parseBody } from '@/parseBody'

/**
 * Marking cuts across libraries, so it hangs off its own root, like
 * favourites. It takes no `:id`, so the lock has nothing to hold it by:
 * targets in libraries this caller may not see are skipped, and the answer
 * is the same either way.
 */
@Controller('api/watched')
export class WatchedController {
  constructor(
    @Inject(LockService) private readonly lock: LockService,
    @Inject(WatchedCards) private readonly cards: WatchedCards,
    @Inject(WatchedRepository) private readonly watched: WatchedRepository,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** Marks every target watched or unwatched; see `WatchedRepository.set` for what that does. */
  @ForViewers()
  @Put()
  @HttpCode(204)
  set(@Body() body: unknown, @Req() request: FastifyRequest): void {
    const change = parseBody({
      guard: isWatchedChange,
      body,
      message: `Send { watched, targets }: 1 to ${MAX_WATCH_TARGETS} targets, each a file or an item.`,
    })
    this.watched.set({
      cards: this.cards.resolve({
        targets: change.targets,
        viewer: this.lock.viewer({ request }),
      }),
      watched: change.watched,
      at: new Date(),
      account: this.accounts.keyOf({ request }),
    })
  }
}
