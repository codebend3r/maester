import type { Transport } from '@/apiClient/transport'
import {
  BUG_REPORT_PARAMS,
  BUG_REPORT_PATHS,
  type BugReport,
  type BugReportStatus,
  type BugReportStatusChange,
  isBugReport,
  isBugReportList,
  type PlaybackDiagnostics,
} from '@/contract'

type SetBugReportStatusProps = {
  id: number
  status: BugReportStatus
}

/** Bug reports: what a player sends when a video will not play, and how the admin works through them. */
export const reportCalls = ({ send, expect }: Transport) => ({
  /** Sends what the player gathered about a video that would not play, for the admin to read later. */
  reportPlaybackError: (diagnostics: PlaybackDiagnostics): Promise<BugReport> =>
    expect({
      request: send({ path: BUG_REPORT_PATHS.reports, method: 'POST', body: diagnostics }),
      guard: isBugReport,
    }),

  /** Every bug report, newest first. Admin only. */
  listBugReports: (): Promise<BugReport[]> =>
    expect({ request: send({ path: BUG_REPORT_PATHS.reports }), guard: isBugReportList }),

  /** Moves a report on, as the admin works through it. Admin only. */
  setBugReportStatus: ({ id, status }: SetBugReportStatusProps): Promise<BugReport> =>
    expect({
      request: send({
        path: BUG_REPORT_PATHS.status.replace(`:${BUG_REPORT_PARAMS.id}`, String(id)),
        method: 'PUT',
        body: { status } satisfies BugReportStatusChange,
      }),
      guard: isBugReport,
    }),
})
