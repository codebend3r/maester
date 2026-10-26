import { Inject, Injectable } from '@nestjs/common'
import {
  BUG_REPORT_STATUSES,
  type BugReport,
  type BugReportStatus,
  type PlaybackDiagnostics,
  isBugReportStatus,
  isRecord,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import type { AccountKey } from '@/media/viewingAccountKeys'

type Row = {
  id: number
  account_id: string
  reporter_email: string | null
  media_id: number | null
  title: string
  summary: string
  status: string
  diagnostics: string
  created_at: string
}

const COLUMNS =
  'id, account_id, reporter_email, media_id, title, summary, status, diagnostics, created_at'

const toReport = (row: Row): BugReport => ({
  id: row.id,
  // A status this server no longer knows reads as new, so the admin looks at it again.
  status: isBugReportStatus(row.status) ? row.status : BUG_REPORT_STATUSES.new,
  createdAt: row.created_at,
  reporter: { accountId: row.account_id, email: row.reporter_email },
  title: row.title,
  summary: row.summary,
  mediaId: row.media_id,
  diagnostics: parseJsonAs({ json: row.diagnostics, guard: isRecord }) ?? {},
})

type BugReportsRepositoryAddProps = {
  account: AccountKey
  email: string | null
  diagnostics: PlaybackDiagnostics
  at: Date
}

type BugReportsRepositoryCountSinceProps = { account: AccountKey; since: Date }

type BugReportsRepositorySetStatusProps = {
  id: number
  status: BugReportStatus
  at: Date
}

/** What the player sent when a video would not play, and where the admin has got to with each. */
@Injectable()
export class BugReportsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** Keeps a new report, under the account that sent it. */
  add({ account, email, diagnostics, at }: BugReportsRepositoryAddProps): BugReport {
    const now = at.toISOString()
    const row = this.db
      .prepare<[Omit<Row, 'id'> & { updated_at: string }], Row>(
        `INSERT INTO bug_reports
           (account_id, reporter_email, media_id, title, summary, status, diagnostics, created_at, updated_at)
         VALUES
           (@account_id, @reporter_email, @media_id, @title, @summary, @status, @diagnostics, @created_at, @updated_at)
         RETURNING ${COLUMNS}`,
      )
      .get({
        account_id: account,
        reporter_email: email,
        media_id: diagnostics.media?.id ?? null,
        title: diagnostics.title,
        summary: diagnostics.problems[0] ?? '',
        status: BUG_REPORT_STATUSES.new,
        diagnostics: JSON.stringify(diagnostics),
        created_at: now,
        updated_at: now,
      })
    if (row === undefined) throw new Error('A bug report was written but not returned')
    return toReport(row)
  }

  /** Every report, newest first. */
  list(): BugReport[] {
    return this.db
      .prepare<[], Row>(`SELECT ${COLUMNS} FROM bug_reports ORDER BY id DESC`)
      .all()
      .map(toReport)
  }

  /** How many reports `account` has sent since `since`. */
  countSince({ account, since }: BugReportsRepositoryCountSinceProps): number {
    const row = this.db
      .prepare<[string, string], { sent: number }>(
        'SELECT COUNT(*) AS sent FROM bug_reports WHERE account_id = ? AND created_at >= ?',
      )
      .get(account, since.toISOString())
    return row?.sent ?? 0
  }

  /** The report with its new status, or null when no report has that id. */
  setStatus({ id, status, at }: BugReportsRepositorySetStatusProps): BugReport | null {
    const row = this.db
      .prepare<[string, string, number], Row>(
        `UPDATE bug_reports SET status = ?, updated_at = ? WHERE id = ? RETURNING ${COLUMNS}`,
      )
      .get(status, at.toISOString(), id)
    return row === undefined ? null : toReport(row)
  }
}
