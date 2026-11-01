import { HEADERS } from '@shared/server'
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Post,
  Put,
  Res,
} from '@nestjs/common'
import {
  type AdminLock,
  isAdminUnlockRequest,
  isScanControlState,
  type ScanControlState,
} from '@raven/core'
import { ScanControl } from '@/scanner/scanControl'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { RatingsRefresh } from '@/libraries/ratingsRefresh'
import type { FastifyReply } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { type AdminChange, AdminService } from '@/admin/adminService'
import { Management } from '@/auth/management'
import { RAVEN_HEADERS } from '@/http'
import { parseBody } from '@/parseBody'

type AppliedProps = { change: AdminChange; reply: FastifyReply }

/** The lock as a change leaves it, with the cookie that carries it set on the reply. */
const applied = ({ change, reply }: AppliedProps): AdminLock => {
  reply.header(HEADERS.setCookie, change.cookie)
  return change.lock
}

const SIGNS_IN_WITH_ACCOUNTS = 'This server signs in with accounts; the owner manages it.'

@Controller('api/admin')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(Management) private readonly management: Pick<Management, 'isLegacy'>,
    @Inject(ScanControl) private readonly scans: ScanControl,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(RatingsRefresh) private readonly ratings: RatingsRefresh,
  ) {}

  @AdminOnly()
  @Get('scans')
  scanState(): ScanControlState {
    return { isStopped: this.scans.isStopped }
  }

  @AdminOnly()
  @Put('scans')
  setScans(@Body() body: unknown): ScanControlState {
    const { isStopped } = parseBody({
      guard: isScanControlState,
      body,
      message: 'isStopped must be boolean',
    })
    this.scans.setStopped(isStopped)
    if (isStopped) {
      this.libraries.list().forEach(({ id }) => {
        this.ratings.cancelQuickScan(id)
        this.ratings.cancel(id)
      })
    }
    return this.scanState()
  }

  /** Once accounts are ready the owner manages raven, and the password and its cookie are inert. */
  private requireLegacy(): void {
    if (!this.management.isLegacy()) throw new NotFoundException(SIGNS_IN_WITH_ACCOUNTS)
  }

  /** The lock in this browser; a session still open gets its cookie renewed, so it never runs out while in use. */
  @Get()
  state(
    @Headers(RAVEN_HEADERS.cookie) cookie: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AdminLock {
    this.requireLegacy()
    const renewed = this.admin.renewed({ cookie })
    return renewed ? applied({ change: renewed, reply }) : this.admin.state({ cookie })
  }

  /** `{ password }`: turns the admin lock off for this browser. */
  @ForViewers()
  @Post('unlock')
  @HttpCode(200)
  unlock(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): AdminLock {
    this.requireLegacy()
    const { password } = parseBody({
      guard: isAdminUnlockRequest,
      body,
      message: 'password must be text',
    })
    const unlocking = this.admin.unlock(password)
    if (!unlocking.ok) throw new HttpException(unlocking.message, unlocking.status)
    reply.header(HEADERS.setCookie, unlocking.cookie)
    return { state: 'off' }
  }

  /** Turns the admin lock back on for this browser, after a wait in which it can be taken back. */
  @ForViewers()
  @Post('lock')
  @HttpCode(200)
  lock(
    @Headers(RAVEN_HEADERS.cookie) cookie: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AdminLock {
    this.requireLegacy()
    const change = this.admin.lock({ cookie })
    return change ? applied({ change, reply }) : this.admin.state({ cookie })
  }

  /** Takes back a lock still on its way; once it holds, only the password turns it off. */
  @ForViewers()
  @Post('keep-unlocked')
  @HttpCode(200)
  keepUnlocked(
    @Headers(RAVEN_HEADERS.cookie) cookie: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): AdminLock {
    this.requireLegacy()
    const change = this.admin.keepUnlocked({ cookie })
    if (!change) {
      throw new ConflictException(
        'The admin lock is on already. Enter the password to turn it off.',
      )
    }
    return applied({ change, reply })
  }
}
