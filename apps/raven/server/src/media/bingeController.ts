import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Put,
  Req,
} from '@nestjs/common'
import { BINGE_LIMIT, type BingeState, isBingeChange } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { Public } from '@/lock/lockGuard'
import { BINGE_OUTCOMES } from '@/media/bingeOutcomes'
import { BingeShows } from '@/media/bingeShows'
import { ViewingAccounts } from '@/media/viewingAccounts'

/** The shows an account is binging, the same on every device it signs in on. */
@Controller('api/binge')
export class BingeController {
  constructor(
    @Inject(BingeShows) private readonly binge: BingeShows,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  @Get()
  get(@Req() request: FastifyRequest): BingeState {
    return this.binge.state({ account: this.accounts.keyOf({ request }) })
  }

  /** Records that the account has seen the binge tip. Declared before `:id` so it is not read as one. */
  @ForViewers()
  @Put('tip')
  dismissTip(@Req() request: FastifyRequest): BingeState {
    const account = this.accounts.keyOf({ request })
    this.binge.dismissTip({ account })
    return this.binge.state({ account })
  }

  /**
   * Public to the lock guard: `BingeShows` refuses a locked library's show
   * itself, PIN or not, and always lets one be removed.
   */
  @Public()
  @ForViewers()
  @Put(':id')
  set(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): BingeState {
    if (!isBingeChange(body)) throw new BadRequestException('binge must be true or false')
    const account = this.accounts.keyOf({ request })
    const outcome = this.binge.set({ itemId: id, binge: body.binge, account })
    switch (outcome) {
      case BINGE_OUTCOMES.done:
        return this.binge.state({ account })
      case BINGE_OUTCOMES.missing:
        throw new NotFoundException(`No show ${id}`)
      case BINGE_OUTCOMES.locked:
        throw new ForbiddenException('A locked library’s shows cannot be binged.')
      case BINGE_OUTCOMES.full:
        throw new ConflictException(`You can binge up to ${BINGE_LIMIT} shows.`)
      default: {
        const unknown: never = outcome
        return unknown
      }
    }
  }
}
