import { BUG_REPORT_STATUSES, PLAYBACK_MODES } from '@raven/core'
import { REPORT_TABS } from '@/pages/BugReportsPage/reportTabs'
type SummaryProps = { reports: string; fresh: number }

type ReportedByProps = { reporter: string; accountId: string }

export const BUG_REPORTS_COPY = {
  title: 'Bug reports',
  managersOnlyFor: 'read what viewers reported',
  serverDidNotAnswer: 'The server did not answer: ',
  loading: 'Looking for bug reports',
  report: 'report',
  reports: 'reports',
  summary: ({ reports, fresh }: SummaryProps) => `${reports}, ${fresh} new`,
  by: ' by ',
  noProblem: 'No problem was listed.',
  status: 'Status',
  ofReport: (id: number) => ` of report ${id}`,
  copyDebugInfo: 'Copy debug info',
  statusFailed: 'Could not change its status: ',
  debugInfo: 'Debug info',
  copied: 'Debug info copied.',
  copyFailed: 'Could not copy. Open Debug info and copy it from there.',
  notALibraryFile: 'Not a library file',
  tried: 'Tried',
  triedNothing: 'Nothing, it could not start',
  browser: 'Browser',
  triedSeparator: ', then ',
  tabs: 'Which reports',
  archive: 'Archive',
  restore: 'Restore',
  delete: 'Delete',
  deleteForGood: 'Delete for good',
  archiveAllFixed: (fixed: number) => `Archive all fixed (${fixed})`,
  changeFailed: 'Could not change the report: ',
  archiveFixedFailed: 'Could not archive the fixed reports: ',
  debug: {
    heading: (id: number) => `raven bug report #${id}`,
    status: (status: string) => `Status: ${status}`,
    reported: (at: string) => `Reported: ${at}`,
    reportedBy: ({ reporter, accountId }: ReportedByProps) =>
      `Reported by: ${reporter} (account ${accountId})`,
    title: (title: string) => `Title: ${title}`,
    problem: (summary: string) => `Problem: ${summary}`,
    mediaId: (mediaId: number | null) => `Media id: ${mediaId ?? 'none'}`,
    diagnostics: 'Diagnostics:',
  },
} as const

/** What each status of a report is called. */
export const BUG_REPORT_STATUS_COPY = {
  [BUG_REPORT_STATUSES.new]: 'New',
  [BUG_REPORT_STATUSES.investigating]: 'Investigating',
  [BUG_REPORT_STATUSES.fixed]: 'Fixed',
  [BUG_REPORT_STATUSES.wontFix]: "Won't fix",
} as const

/** What each way of playing a file is called in a report. */
export const BUG_REPORT_MODE_COPY = {
  [PLAYBACK_MODES.direct]: 'Direct play',
  [PLAYBACK_MODES.remux]: 'Remux',
  [PLAYBACK_MODES.transcode]: 'Transcode',
} as const

/** What each tab of the page is called. */
export const BUG_REPORT_TAB_COPY = {
  [REPORT_TABS.current]: 'Current',
  [REPORT_TABS.archived]: 'Archived',
} as const

/** What an empty tab says. */
export const BUG_REPORT_EMPTY_COPY = {
  [REPORT_TABS.current]: 'Nothing has been reported',
  [REPORT_TABS.archived]: 'Nothing has been archived',
} as const
