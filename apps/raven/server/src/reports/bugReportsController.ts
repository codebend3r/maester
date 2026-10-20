import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
} from '@nestjs/common'
import {
  BUG_REPORT_PARAMS,
  BUG_REPORT_PATHS,
  type BugReport,
  MAX_BUG_REPORT_BYTES,
  isBugReportStatusChange,
  isPlaybackDiagnostics,
  withoutTickets,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { AuthSessions, accountOf } from '@/auth/authSessions'
import { Public } from '@/lock/lockGuard'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { parseBody } from '@/parseBody'
import { BugReportsRepository } from '@/reports/bugReportsRepository'

/** How many reports one account may send in `REPORT_WINDOW_MS`, so a stuck player cannot fill the disk. */
export const MAX_REPORTS_PER_WINDOW = 20

const REPORT_WINDOW_MS = 3_600_000

/** Report this error from the player, and the admin's list of what was reported. */
@Controller()
export class BugReportsController {
  constructor(
    @Inject(BugReportsRepository) private readonly reports: BugReportsRepository,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(AuthSessions) private readonly sessions: Pick<AuthSessions, 'callerOf'>,
  ) {}

  /** Keeps what the player gathered, under the account asking: never one the body names. */
  @ForViewers()
  @Post(BUG_REPORT_PATHS.reports)
  report(@Req() request: FastifyRequest, @Body() body: unknown): BugReport {
    if (Buffer.byteLength(JSON.stringify(body ?? null)) > MAX_BUG_REPORT_BYTES) {
      throw new PayloadTooLargeException('The report is too large to keep.')
    }
    const diagnostics = parseBody({
      guard: isPlaybackDiagnostics,
      body,
      message: 'The report is missing what the player knew about the error.',
    })
    const account = this.accounts.keyOf({ request })
    const now = new Date()
    const sent = this.reports.countSince({
      account,
      since: new Date(now.getTime() - REPORT_WINDOW_MS),
    })
    if (sent >= MAX_REPORTS_PER_WINDOW) {
      throw new HttpException(
        'Too many reports from this account. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    return this.reports.add({
      account,
      email: accountOf(this.sessions.callerOf({ request }))?.email ?? null,
      diagnostics: withoutTickets(diagnostics),
      at: now,
    })
  }

  /** Every report, newest first. */
  @AdminOnly()
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(BUG_REPORT_PATHS.reports)
  list(): BugReport[] {
    return this.reports.list()
  }

  /** Moves a report on: investigating, fixed or won't fix, or back to new. */
  @AdminOnly()
  @Public()
  @Put(BUG_REPORT_PATHS.status)
  setStatus(
    @Param(BUG_REPORT_PARAMS.id, ParseIntPipe) id: number,
    @Body() body: unknown,
  ): BugReport {
    const { status } = parseBody({
      guard: isBugReportStatusChange,
      body,
      message: 'Expected a status a report can have.',
    })
    const report = this.reports.setStatus({ id, status, at: new Date() })
    if (report === null) throw new NotFoundException('No report')
    return report
  }
}
