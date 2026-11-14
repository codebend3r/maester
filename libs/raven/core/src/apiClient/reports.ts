import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  BUG_REPORT_PARAMS,
  type BugReport,
  type BugReportStatus,
  type BugReportStatusChange,
  type PlaybackDiagnostics,
} from '@/contract'

type SetBugReportStatusProps = {
  id: number
  status: BugReportStatus
}

/** Bug reports: what a player sends when a video will not play, and how the admin works through them. */
export const reportCalls = ({ ask }: Transport) => ({
  /** Sends what the player gathered about a video that would not play, for the admin to read later. */
  reportPlaybackError: (diagnostics: PlaybackDiagnostics): Promise<BugReport> =>
    ask({ route: ROUTES.reportPlaybackError, body: diagnostics }),

  /** Every bug report, newest first. Admin only. */
  listBugReports: (): Promise<BugReport[]> => ask({ route: ROUTES.listBugReports }),

  /** Moves a report on, as the admin works through it. Admin only. */
  setBugReportStatus: ({ id, status }: SetBugReportStatusProps): Promise<BugReport> =>
    ask({
      route: ROUTES.setBugReportStatus,
      params: { [BUG_REPORT_PARAMS.id]: id },
      body: { status } satisfies BugReportStatusChange,
    }),
})
