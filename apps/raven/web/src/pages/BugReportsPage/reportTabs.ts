import type { BugReport } from '@raven/core'

/** The Bug reports page's tabs: the reports being worked through, and the ones put away. */
export const REPORT_TABS = {
  current: 'current',
  archived: 'archived',
} as const

export type ReportTab = (typeof REPORT_TABS)[keyof typeof REPORT_TABS]

/** The tab a report is listed under. */
export const tabOf = (report: BugReport): ReportTab =>
  report.archivedAt === null ? REPORT_TABS.current : REPORT_TABS.archived

/** Each tab's reports, in the order they came. */
export type ReportsByTab = Readonly<Record<ReportTab, readonly BugReport[]>>

/** The reports sorted onto their tabs, each keeping the order they came in. */
export const reportsByTab = (reports: readonly BugReport[]): ReportsByTab =>
  reports.reduce<ReportsByTab>(
    (byTab, report) => {
      const tab = tabOf(report)
      return { ...byTab, [tab]: [...byTab[tab], report] }
    },
    { [REPORT_TABS.current]: [], [REPORT_TABS.archived]: [] },
  )
