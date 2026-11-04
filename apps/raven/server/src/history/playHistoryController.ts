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
import {
  type HistoryCursor,
  PlayHistoryRepository,
  parseCursor,
} from '@/history/playHistoryRepository'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { LockService, PRIVACIES } from '@/lock/lockService'
import { type AccountKey, VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { parseBody } from '@/parseBody'
import { ROUTE_PARAMS } from '@/requestParts'

/** What a page's query asks, as the routes read it off the address. */
type PageQuery = {
  before: unknown
  limit: unknown
  show: unknown
}

type ReadPageProps = PageQuery & {
  request: FastifyRequest
  whose: AccountKey | null
}

const limitOf = (asked: unknown): number => {
  const limit = isString(asked) ? Number.parseInt(asked, 10) : Number.NaN
  return Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), PLAY_HISTORY_PAGE.most)
    : PLAY_HISTORY_PAGE.size
}

const showOf = (asked: unknown): PlayHistoryShow => {
  if (asked === undefined) return PLAY_HISTORY_SHOWS.all
  if (isPlayHistoryShow(asked)) return asked
  throw new BadRequestException(`show must be one of ${isPlayHistoryShow.values.join(', ')}`)
}

const cursorOf = (asked: unknown): HistoryCursor | null => {
  if (asked === undefined) return null
  const cursor = isString(asked) ? parseCursor(asked) : null
  if (cursor === null) throw new BadRequestException('before is not a cursor this server made')
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
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(LockService) private readonly lock: Pick<LockService, 'viewer'>,
    @Inject(LibrariesRepository) private readonly libraries: Pick<LibrariesRepository, 'lockedIds'>,
  ) {}

  /** Locked libraries' entries stay out of sight until this caller unlocks them, the owner's view included. */
  private readPage({ request, whose, before, limit, show }: ReadPageProps): PlayHistoryPage {
    const viewer = this.lock.viewer({ request })
    return this.history.page({
      whose,
      before: cursorOf(before),
      show: showOf(show),
      limit: limitOf(limit),
      hidden: [...this.libraries.lockedIds()].filter((id) => !viewer.seesLibrary(id)),
      reader: this.accounts.keyOf({ request }),
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
    return this.readPage({ request, whose: this.accounts.keyOf({ request }), before, limit, show })
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
    return this.readPage({ request, whose: accountOf(account), before, limit, show })
  }

  /** A track started playing: its listen's id, for the reports that follow. */
  @ForViewers()
  @PrivateBy(PRIVACIES.media)
  @Post(PLAY_HISTORY_PATHS.startListen)
  @HttpCode(200)
  startListen(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): ListenStarted {
    const { position } = parseBody({
      guard: isListenStart,
      body,
      message: 'position must be a number of seconds',
    })
    const started = this.history.startListen({
      account: this.accounts.keyOf({ request }),
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
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): void {
    const { position } = parseBody({
      guard: isListenReport,
      body,
      message: 'position must be a number of seconds',
    })
    if (!this.history.reportListen({ account: this.accounts.keyOf({ request }), id, position })) {
      throw new NotFoundException(`No listen ${id}`)
    }
  }
}
