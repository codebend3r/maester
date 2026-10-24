import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Put,
  Req,
} from '@nestjs/common'
import { type HeroPicks, isHeroPickChange } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { AdminOnly } from '@/admin/adminGuard'
import { HeroRepository } from '@/hero/heroRepository'
import { HeroSelection } from '@/hero/heroSelection'
import { LockService } from '@/lock/lockService'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { parseBody } from '@/parseBody'

/** Which movies and shows the admin put in home's hero. */
@Controller('api/hero')
export class HeroController {
  constructor(
    @Inject(HeroRepository) private readonly picks: HeroRepository,
    @Inject(HeroSelection) private readonly selection: HeroSelection,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  private state(): HeroPicks {
    return { itemIds: this.picks.picks(), limit: this.selection.limit }
  }

  @AdminOnly()
  @Get('picks')
  list(): HeroPicks {
    return this.state()
  }

  /**
   * Puts a movie or show in the hero, or takes it out. Only a title with
   * the pictures the hero lays out, in a pinned library that is in the hero and not locked, can go in, and
   * only while the hero has room.
   */
  @AdminOnly()
  @Put('picks')
  set(@Body() body: unknown, @Req() request: FastifyRequest): HeroPicks {
    const { itemId, isShown } = parseBody({
      guard: isHeroPickChange,
      body,
      message: 'itemId must be an item id and isShown true or false.',
    })
    if (!isShown) {
      this.picks.remove({ itemId })
      return this.state()
    }
    const canPick = this.selection.canPick({
      itemId,
      viewer: this.lock.viewer({ request }),
      account: this.accounts.keyOf({ request }),
    })
    if (!canPick) {
      throw new BadRequestException(
        'Only a movie or show with a poster and a backdrop, in a pinned library that is included in the hero and not locked, can go in it.',
      )
    }
    const { itemIds } = this.state()
    if (itemIds.includes(itemId)) return this.state()
    if (itemIds.length >= this.selection.limit) {
      throw new ConflictException(
        `The hero holds at most ${this.selection.limit} titles; take one out first.`,
      )
    }
    this.picks.add({ itemId })
    return this.state()
  }
}
