import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
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
  isBugReportArchiveChange,
  isBugReportStatusChange,
  isPlaybackDiagnostics,
  withoutTickets,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS, HTTP_STATUSES } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { AuthSessions, accountOf } from '@/auth/authSessions'
import { Public } from '@/lock/lockGuard'
import { parseBody } from '@/parseBody'
import { BUG_REPORT_DELETIONS, BugReportsRepository } from '@/reports/bugReportsRepository'
import { ViewingAccount } from '@/media/viewingAccountParam'
import type { AccountKey } from '@/media/viewingAccountKeys'

/** How many reports one account may send in `REPORT_WINDOW_MS`, so a stuck player cannot fill the disk. */
export const MAX_REPORTS_PER_WINDOW = 20

const REPORT_WINDOW_MS = 3_600_000

/** Report this error from the player, and the admin's list of what was reported. */
@Controller()
export class BugReportsController {
  constructor(
    @Inject(BugReportsRepository) private readonly reports: BugReportsRepository,
    @Inject(AuthSessions) private readonly sessions: Pick<AuthSessions, 'callerOf'>,
  ) {}

  /** Keeps what the player gathered, under the account asking: never one the body names. */
  @ForViewers()
  @Post(BUG_REPORT_PATHS.reports)
  report(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @ViewingAccount() account: AccountKey,
  ): BugReport {
    if (Buffer.byteLength(JSON.stringify(body ?? null)) > MAX_BUG_REPORT_BYTES) {
      throw new PayloadTooLargeException('The report is too large to keep.')
    }
    const diagnostics = parseBody({
      guard: isPlaybackDiagnostics,
      body,
      message: 'The report is missing what the player knew about the error.',
    })
    const now = new Date()
    const sent = this.reports.countSince({
      account,
      since: new Date(now.getTime() - REPORT_WINDOW_MS),
    })
    if (sent >= MAX_REPORTS_PER_WINDOW) {
      throw new HttpException(
        'Too many reports from this account. Try again in an hour.',
        HTTP_STATUSES.tooManyRequests,
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

  /** Moves a report to the archive, or brings it back to the current list. */
  @AdminOnly()
  @Public()
  @Put(BUG_REPORT_PATHS.archive)
  archive(@Param(BUG_REPORT_PARAMS.id, ParseIntPipe) id: number, @Body() body: unknown): BugReport {
    const { isArchived } = parseBody({
      guard: isBugReportArchiveChange,
      body,
      message: 'Expected whether the report is archived.',
    })
    const report = this.reports.archive({ id, isArchived, at: new Date() })
    if (report === null) throw new NotFoundException('No report')
    return report
  }

  /** Archives every report on the current list with the status named, answering with them. */
  @AdminOnly()
  @Public()
  @HttpCode(HTTP_STATUSES.ok)
  @Post(BUG_REPORT_PATHS.archiveByStatus)
  archiveByStatus(@Body() body: unknown): BugReport[] {
    const { status } = parseBody({
      guard: isBugReportStatusChange,
      body,
      message: 'Expected the status of the reports to archive.',
    })
    return this.reports.archiveByStatus({ status, at: new Date() })
  }

  /** Deletes an archived report, so no list shows it again; one on the current list is refused. */
  @AdminOnly()
  @Public()
  @HttpCode(HTTP_STATUSES.noContent)
  @Delete(BUG_REPORT_PATHS.report)
  remove(@Param(BUG_REPORT_PARAMS.id, ParseIntPipe) id: number): void {
    const outcome = this.reports.delete({ id, at: new Date() })
    switch (outcome) {
      case BUG_REPORT_DELETIONS.deleted:
        return
      case BUG_REPORT_DELETIONS.current:
        throw new ConflictException('Archive the report before deleting it.')
      case BUG_REPORT_DELETIONS.missing:
        throw new NotFoundException('No report')
      default: {
        const unreachable: never = outcome
        throw new Error(`Unknown deletion: ${JSON.stringify(unreachable)}`)
      }
    }
  }
}
