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
  DISCOVERY_PATHS,
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
import { Public } from '@/lock/lockGuard'
import { ListenerScopes } from '@/music/listenerScope'
import { Mixes } from '@/music/mixes'
import { RADIO_OUTCOMES, Radio } from '@/music/radio'
import { ROUTE_PARAMS } from '@/requestParts'

/**
 * The calling account's mixes, radio and Home's recent albums. None is in a
 * library, so the lock holds no route by its id; a locked library's tracks
 * and albums are left out of every answer instead, as a playlist leaves
 * them out, and a radio seeded in one is refused as the lock refuses a
 * route by its id: 423 to one who could enter the PIN, else 404.
 */
@Controller()
@Public()
export class MixesController {
  constructor(
    @Inject(Mixes) private readonly mixes: Mixes,
    @Inject(Radio) private readonly radio: Radio,
    @Inject(Management) private readonly management: Management,
    @Inject(ListenerScopes) private readonly scopes: ListenerScopes,
  ) {}

  /** Today's mixes; one with too few tracks is left out. */
  @Get(DISCOVERY_PATHS.mixes)
  list(@Req() request: FastifyRequest): MixSummary[] {
    return this.mixes.list(this.scopes.of({ request }))
  }

  /** One mix by its kind, with its tracks in today's order. */
  @Get(DISCOVERY_PATHS.mix)
  get(@Param(ROUTE_PARAMS.id) id: string, @Req() request: FastifyRequest): MixDetails {
    const mix = isMixKind(id) ? this.mixes.get({ kind: id, ...this.scopes.of({ request }) }) : null
    if (mix === null) throw new NotFoundException(`No mix ${id}`)
    return mix
  }

  /** Up to 50 tracks around `?seed=`: `track:<mediaId>`, `artist:<id>` or `album:<id>`. */
  @Get(DISCOVERY_PATHS.radio)
  async getRadio(
    @Query(RADIO_PARAMS.seed) seedText: unknown,
    @Req() request: FastifyRequest,
  ): Promise<Track[]> {
    const seed = radioSeedOf(seedText)
    if (seed === null) {
      throw new BadRequestException('seed must be track:<id>, artist:<id> or album:<id>')
    }
    const answer = await this.radio.play({ seed, ...this.scopes.of({ request }) })
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
  @Get(DISCOVERY_PATHS.recent)
  recent(@Req() request: FastifyRequest): RecentAlbums {
    return this.mixes.recent(this.scopes.of({ request }))
  }
}
