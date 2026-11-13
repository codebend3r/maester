import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import {
  type ListenStarted,
  PLAY_HISTORY_PAGE,
  PLAY_HISTORY_PARAMS,
  PLAY_HISTORY_PATHS,
  PLAY_HISTORY_SHOWS,
  type PlayHistoryPage,
  type PlayHistoryShow,
  isAccountId,
  isListenReport,
  isListenStart,
  isPlayHistoryShow,
  isString,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { PlayHistoryRepository } from '@/history/playHistoryRepository'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { PRIVACIES } from '@/lock/lockService'
import { type AccountKey, VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import { type ListenerScope, ListenerScopes } from '@/music/listenerScope'
import { parseBody } from '@/parseBody'
import { ROUTE_PARAMS } from '@/requestParts'
import { pageLimit } from '@/queryValues'
import { ViewingAccount } from '@/media/viewingAccountParam'

/** What a page's query asks, as the routes read it off the address. */
type PageQuery = {
  before: unknown
  limit: unknown
  show: unknown
}

type ReadPageProps = PageQuery & {
  scope: ListenerScope
  whose: AccountKey | null
}

const showOf = (asked: unknown): PlayHistoryShow => {
  if (asked === undefined) return PLAY_HISTORY_SHOWS.all
  if (isPlayHistoryShow(asked)) return asked
  throw new BadRequestException(`show must be one of ${isPlayHistoryShow.values.join(', ')}`)
}

/** The `next` an earlier page answered: an entry's id. */
const cursorOf = (asked: unknown): number | null => {
  if (asked === undefined) return null
  const cursor = isString(asked) && /^[1-9]\d*$/.test(asked) ? Number(asked) : Number.NaN
  if (!Number.isSafeInteger(cursor)) throw new BadRequestException('before is not an entry id')
  return cursor
}

/** An account the owner asked for: a Supabase user's id, or the viewer of a server without accounts. */
const accountOf = (asked: unknown): AccountKey | null => {
  if (asked === undefined) return null
  if (asked === VIEWING_ACCOUNTS.local) return VIEWING_ACCOUNTS.local
  if (isAccountId(asked)) return asked
  throw new BadRequestException('account is not an account id')
}

/**
 * The play history: each account's own, everyone's for the owner, and the
 * listens a music player starts and reports. A video's entries come from
 * its plays, so it reports nothing here.
 */
@Controller()
export class PlayHistoryController {
  constructor(
    @Inject(PlayHistoryRepository) private readonly history: PlayHistoryRepository,
    @Inject(ListenerScopes) private readonly scopes: ListenerScopes,
  ) {}

  /** Locked libraries' entries stay out of sight until this caller unlocks them, the owner's view included. */
  private readPage({ scope, whose, before, limit, show }: ReadPageProps): PlayHistoryPage {
    return this.history.page({
      whose,
      before: cursorOf(before),
      show: showOf(show),
      limit: pageLimit({
        asked: limit,
        fallback: PLAY_HISTORY_PAGE.size,
        most: PLAY_HISTORY_PAGE.most,
      }),
      scope,
    })
  }

  /** The caller's own history, newest first: only ever its own account's. */
  @Get(PLAY_HISTORY_PATHS.own)
  own(
    @Req() request: FastifyRequest,
    @Query(PLAY_HISTORY_PARAMS.before) before: unknown,
    @Query(PLAY_HISTORY_PARAMS.limit) limit: unknown,
    @Query(PLAY_HISTORY_PARAMS.show) show: unknown,
  ): PlayHistoryPage {
    const scope = this.scopes.of({ request })
    return this.readPage({ scope, whose: scope.account, before, limit, show })
  }

  /**
   * Every account's history, or the one `account` names, newest first. The
   * owner's alone: this is the one read of viewing that names its account
   * in the query, and the admin guard is what lets it.
   */
  @AdminOnly()
  @Get(PLAY_HISTORY_PATHS.everyone)
  everyone(
    @Req() request: FastifyRequest,
    @Query(PLAY_HISTORY_PARAMS.before) before: unknown,
    @Query(PLAY_HISTORY_PARAMS.limit) limit: unknown,
    @Query(PLAY_HISTORY_PARAMS.show) show: unknown,
    @Query(PLAY_HISTORY_PARAMS.account) account: unknown,
  ): PlayHistoryPage {
    return this.readPage({
      scope: this.scopes.of({ request }),
      whose: accountOf(account),
      before,
      limit,
      show,
    })
  }

  /** A track started playing: its listen's id, for the reports that follow. */
  @ForViewers()
  @PrivateBy(PRIVACIES.media)
  @Post(PLAY_HISTORY_PATHS.startListen)
  @HttpCode(200)
  startListen(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Body() body: unknown,
    @ViewingAccount() account: AccountKey,
  ): ListenStarted {
    const { position } = parseBody({
      guard: isListenStart,
      body,
      message: 'position must be a number of seconds',
    })
    const started = this.history.startListen({
      account,
      mediaId: id,
      position,
    })
    if (started === null) throw new NotFoundException(`No track ${id}`)
    return { id: started }
  }

  /** How far one of the caller's listens got; another account's is answered as missing. */
  @ForViewers()
  @Public()
  @Put(PLAY_HISTORY_PATHS.listen)
  @HttpCode(204)
  reportListen(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Body() body: unknown,
    @ViewingAccount() account: AccountKey,
  ): void {
    const { position } = parseBody({
      guard: isListenReport,
      body,
      message: 'position must be a number of seconds',
    })
    if (!this.history.reportListen({ account, id, position })) {
      throw new NotFoundException(`No listen ${id}`)
    }
  }
}
