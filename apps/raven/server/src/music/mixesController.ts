import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common'
import {
  LOCKED_STATUS,
  type MixDetails,
  type MixSummary,
  RADIO_PARAMS,
  type RecentAlbums,
  type Track,
  isMixKind,
  radioSeedOf,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { Management } from '@/auth/management'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { Mixes } from '@/music/mixes'
import { RADIO_OUTCOMES, Radio } from '@/music/radio'

type MixesControllerScopeProps = { request: FastifyRequest }

/**
 * The calling account's mixes, radio and Home's recent albums. None is in a
 * library, so the lock holds no route by its id; a locked library's tracks
 * and albums are left out of every answer instead, as a playlist leaves
 * them out, and a radio seeded in one is refused as the lock refuses a
 * route by its id: 423 to one who could enter the PIN, else 404.
 */
@Controller('api/music')
@Public()
export class MixesController {
  constructor(
    @Inject(Mixes) private readonly mixes: Mixes,
    @Inject(Radio) private readonly radio: Radio,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(Management) private readonly management: Management,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** Whose plays a request reads, and the libraries whose tracks it may not see. */
  private scope({ request }: MixesControllerScopeProps) {
    const viewer = this.lock.viewer({ request })
    return {
      account: this.accounts.keyOf({ request }),
      hidden: [...this.libraries.lockedIds()].filter((id) => !viewer.seesLibrary(id)),
    }
  }

  /** Today's mixes; one with too few tracks is left out. */
  @Get('mixes')
  list(@Req() request: FastifyRequest): MixSummary[] {
    return this.mixes.list(this.scope({ request }))
  }

  /** One mix by its kind, with its tracks in today's order. */
  @Get('mixes/:id')
  get(@Param('id') id: string, @Req() request: FastifyRequest): MixDetails {
    const mix = isMixKind(id) ? this.mixes.get({ kind: id, ...this.scope({ request }) }) : null
    if (mix === null) throw new NotFoundException(`No mix ${id}`)
    return mix
  }

  /** Up to 50 tracks around `?seed=`: `track:<mediaId>`, `artist:<id>` or `album:<id>`. */
  @Get('radio')
  async getRadio(
    @Query(RADIO_PARAMS.seed) seedText: unknown,
    @Req() request: FastifyRequest,
  ): Promise<Track[]> {
    const seed = radioSeedOf(seedText)
    if (seed === null) {
      throw new BadRequestException('seed must be track:<id>, artist:<id> or album:<id>')
    }
    const answer = await this.radio.play({ seed, ...this.scope({ request }) })
    switch (answer.outcome) {
      case RADIO_OUTCOMES.found:
        return answer.tracks
      case RADIO_OUTCOMES.missing:
        throw new NotFoundException(`No ${seed.kind} ${seed.id}`)
      case RADIO_OUTCOMES.locked:
        if (!this.management.canManage({ request })) {
          throw new NotFoundException(`No ${seed.kind} ${seed.id}`)
        }
        throw new HttpException('This library is locked.', LOCKED_STATUS)
      default: {
        const unknown: never = answer
        return unknown
      }
    }
  }

  /** The albums the account played last and those added last, 20 of each. */
  @Get('recent')
  recent(@Req() request: FastifyRequest): RecentAlbums {
    return this.mixes.recent(this.scope({ request }))
  }
}
