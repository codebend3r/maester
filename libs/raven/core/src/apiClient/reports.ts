import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  BUG_REPORT_PARAMS,
  type BugReport,
  type BugReportArchiveChange,
  type BugReportStatus,
  type BugReportStatusChange,
  type PlaybackDiagnostics,
} from '@/contract'

type ArchiveBugReportProps = {
  id: number
  isArchived: boolean
}

type SetBugReportStatusProps = {
  id: number
  status: BugReportStatus
}

/** Bug reports: what a player sends when a video will not play, and how the admin works through them. */
export const reportCalls = ({ ask, tell }: Transport) => ({
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

  /** Moves a report to the archive, or brings it back to the current list. Admin only. */
  archiveBugReport: ({ id, isArchived }: ArchiveBugReportProps): Promise<BugReport> =>
    ask({
      route: ROUTES.archiveBugReport,
      params: { [BUG_REPORT_PARAMS.id]: id },
      body: { isArchived } satisfies BugReportArchiveChange,
    }),

  /** Archives every report on the current list with `status`, and answers with them. Admin only. */
  archiveBugReportsByStatus: ({ status }: BugReportStatusChange): Promise<BugReport[]> =>
    ask({
      route: ROUTES.archiveBugReportsByStatus,
      body: { status } satisfies BugReportStatusChange,
    }),

  /** Hides an archived report from every list for good. Admin only. */
  deleteBugReport: async (id: number): Promise<void> => {
    await tell({ route: ROUTES.deleteBugReport, params: { [BUG_REPORT_PARAMS.id]: id } })
  },
})
