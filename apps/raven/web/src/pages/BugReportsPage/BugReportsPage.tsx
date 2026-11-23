import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BUG_REPORT_STATUSES,
  type BugReport,
  type BugReportStatus,
  type PlaybackMode,
  isBugReportStatus,
  isPlaybackDiagnostics,
  plural,
} from '@raven/core'
import { BUTTON_TONES, Button } from '@raven/ui'
import { type ComponentType, useId, useState } from 'react'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ForManagers } from '@/components/ManagersOnly/ManagersOnly'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { copyText } from '@/lib/clipboard'
import { api } from '@/lib/api'
import { bugReportsQuery } from '@/lib/queries'
import {
  BUG_REPORTS_COPY,
  BUG_REPORT_EMPTY_COPY,
  BUG_REPORT_MODE_COPY,
  BUG_REPORT_STATUS_COPY,
  BUG_REPORT_TAB_COPY,
} from '@/pages/BugReportsPage/copy'
import {
  REPORT_TABS,
  type ReportTab,
  type ReportsByTab,
  reportsByTab,
  tabOf,
} from '@/pages/BugReportsPage/reportTabs'
import { Tabs } from '@/components/Tabs/Tabs'
import styles from '@/pages/BugReportsPage/BugReportsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'

const STATUS_LABELS = BUG_REPORT_STATUS_COPY satisfies Record<BugReportStatus, string>

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const reporterOf = (report: BugReport): string => report.reporter.email ?? report.reporter.accountId

/** Everything a report holds as plain text: a few lines to read, then the diagnostics as sent. */
const debugText = (report: BugReport): string =>
  [
    BUG_REPORTS_COPY.debug.heading(report.id),
    BUG_REPORTS_COPY.debug.status(STATUS_LABELS[report.status]),
    BUG_REPORTS_COPY.debug.reported(report.createdAt),
    BUG_REPORTS_COPY.debug.reportedBy({
      reporter: reporterOf(report),
      accountId: report.reporter.accountId,
    }),
    BUG_REPORTS_COPY.debug.title(report.title),
    BUG_REPORTS_COPY.debug.problem(report.summary),
    BUG_REPORTS_COPY.debug.mediaId(report.mediaId),
    '',
    BUG_REPORTS_COPY.debug.diagnostics,
    JSON.stringify(report.diagnostics, null, 2),
  ].join('\n')

const MODE_LABELS = BUG_REPORT_MODE_COPY satisfies Record<PlaybackMode, string>

/** The ways that were tried and failed, in order; null when none got as far as starting. */
const triedWords = (modes: readonly PlaybackMode[]): string | null =>
  modes.length === 0
    ? null
    : modes.map((mode) => MODE_LABELS[mode]).join(BUG_REPORTS_COPY.triedSeparator)

/** The facts worth a glance before the full diagnostics; none from a report this page cannot read. */
const glanceFacts = (report: BugReport): Array<{ name: string; value: string }> => {
  const { diagnostics } = report
  if (!isPlaybackDiagnostics(diagnostics)) return []
  const tried = triedWords(diagnostics.playback?.attempts.map(({ mode }) => mode) ?? [])
  return [
    {
      name: COMMON_COPY.file,
      value: diagnostics.media?.fileName ?? BUG_REPORTS_COPY.notALibraryFile,
    },
    { name: BUG_REPORTS_COPY.tried, value: tried ?? BUG_REPORTS_COPY.triedNothing },
    { name: BUG_REPORTS_COPY.browser, value: diagnostics.device.userAgent },
  ]
}

const COPY_FEEDBACK = {
  copied: BUG_REPORTS_COPY.copied,
  failed: BUG_REPORTS_COPY.copyFailed,
} as const

type CopyFeedback = (typeof COPY_FEEDBACK)[keyof typeof COPY_FEEDBACK]

type ReportsChange<T> = {
  mutationFn: (variables: T) => Promise<unknown>
  /** The list as it reads once the change is made, shown before the server answers. */
  change: (reports: readonly BugReport[], variables: T) => BugReport[]
}

/**
 * A change to the reports shown at once, put back if the server refuses it, and read again
 * from the server either way.
 */
const useReportsChange = <T,>({ mutationFn, change }: ReportsChange<T>) => {
  const queryClient = useQueryClient()
  const { queryKey } = bugReportsQuery
  return useMutation({
    mutationFn,
    onMutate: async (variables: T) => {
      await queryClient.cancelQueries({ queryKey })
      const before = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(queryKey, (reports) => reports && change(reports, variables))
      return { before }
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(queryKey, context.before)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}

type ArchiveChange = { id: number; isArchived: boolean }

const useArchive = () =>
  useReportsChange({
    mutationFn: ({ id, isArchived }: ArchiveChange) => api.archiveBugReport({ id, isArchived }),
    change: (reports, { id, isArchived }) =>
      reports.map((report) =>
        report.id === id
          ? { ...report, archivedAt: isArchived ? new Date().toISOString() : null }
          : report,
      ),
  })

type ReportActionsProps = { report: BugReport }

/** What the admin can do with a report on the current list: put it away. */
const CurrentActions = ({ report }: ReportActionsProps) => {
  const archive = useArchive()
  return (
    <>
      <Button
        icon="archive"
        disabled={archive.isPending}
        onClick={() => archive.mutate({ id: report.id, isArchived: true })}
      >
        {BUG_REPORTS_COPY.archive}
      </Button>
      {archive.isError && (
        <p className={styles.actionError} role="alert">
          {BUG_REPORTS_COPY.changeFailed}
          {archive.error.message}
        </p>
      )}
    </>
  )
}

/** What the admin can do with an archived report: bring it back, or delete it, asked twice. */
const ArchivedActions = ({ report }: ReportActionsProps) => {
  const [isConfirming, setConfirming] = useState(false)
  const restore = useArchive()
  const remove = useReportsChange({
    mutationFn: (id: number) => api.deleteBugReport(id),
    change: (reports, id) => reports.filter((shown) => shown.id !== id),
  })
  const failed = restore.error ?? remove.error
  const isBusy = restore.isPending || remove.isPending
  return (
    <>
      <Button
        icon="reset"
        disabled={isBusy}
        onClick={() => restore.mutate({ id: report.id, isArchived: false })}
      >
        {BUG_REPORTS_COPY.restore}
      </Button>
      <Button
        tone={BUTTON_TONES.danger}
        icon="trash"
        disabled={isBusy}
        onClick={() => (isConfirming ? remove.mutate(report.id) : setConfirming(true))}
      >
        {isConfirming ? BUG_REPORTS_COPY.deleteForGood : BUG_REPORTS_COPY.delete}
      </Button>
      {failed !== null && (
        <p className={styles.actionError} role="alert">
          {BUG_REPORTS_COPY.changeFailed}
          {failed.message}
        </p>
      )}
    </>
  )
}

/** Each tab's actions on one of its reports. */
const REPORT_ACTIONS = {
  [REPORT_TABS.current]: CurrentActions,
  [REPORT_TABS.archived]: ArchivedActions,
} as const satisfies Record<ReportTab, ComponentType<ReportActionsProps>>

type ReportRowProps = { report: BugReport }

/**
 * One report as a card: what failed and for whom, its status to move on as
 * the admin works through it, and Copy debug info for everything it holds.
 */
const ReportRow = ({ report }: ReportRowProps) => {
  const statusId = useId()
  const [copied, setCopied] = useState<CopyFeedback | null>(null)
  const status = useReportsChange({
    mutationFn: (next: BugReportStatus) => api.setBugReportStatus({ id: report.id, status: next }),
    change: (reports, next) =>
      reports.map((shown) => (shown.id === report.id ? { ...shown, status: next } : shown)),
  })
  const Actions = REPORT_ACTIONS[tabOf(report)]
  const facts = glanceFacts(report)
  const copy = async () => {
    setCopied((await copyText(debugText(report))) ? COPY_FEEDBACK.copied : COPY_FEEDBACK.failed)
  }

  return (
    <li className={styles.row}>
      <h2 className={styles.title}>{report.title}</h2>
      <p className={styles.meta}>
        <time dateTime={report.createdAt}>{when.format(new Date(report.createdAt))}</time>
        {BUG_REPORTS_COPY.by}
        {reporterOf(report)}
      </p>
      <p className={styles.problem}>
        {report.summary === '' ? BUG_REPORTS_COPY.noProblem : report.summary}
      </p>
      <div className={styles.status}>
        <label htmlFor={statusId}>
          {BUG_REPORTS_COPY.status}
          <span className="visually-hidden">{BUG_REPORTS_COPY.ofReport(report.id)}</span>
        </label>
        <select
          id={statusId}
          value={report.status}
          onChange={(event) => {
            const next = event.target.value
            if (isBugReportStatus(next)) status.mutate(next)
          }}
        >
          {isBugReportStatus.values.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      {facts.length > 0 && (
        <dl className={styles.facts}>
          {facts.map(({ name, value }) => (
            <div key={name} className={styles.fact}>
              <dt className={styles.factName}>{name}</dt>
              <dd className={styles.factValue}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className={styles.actions}>
        <Button
          icon="copy"
          onClick={() => {
            copy().catch(() => setCopied(COPY_FEEDBACK.failed))
          }}
        >
          {BUG_REPORTS_COPY.copyDebugInfo}
        </Button>
        <Actions report={report} />
        <p className={styles.feedback} aria-live="polite">
          {copied}
        </p>
      </div>
      {status.isError && (
        <p className={styles.error} role="alert">
          {BUG_REPORTS_COPY.statusFailed}
          {status.error.message}
        </p>
      )}
      <details className={styles.details}>
        <summary>{BUG_REPORTS_COPY.debugInfo}</summary>
        <pre className={styles.json}>{JSON.stringify(report.diagnostics, null, 2)}</pre>
      </details>
    </li>
  )
}

/** Two cards on their way. */
const RowsSkeleton = () => (
  <Loading label={BUG_REPORTS_COPY.loading}>
    <ul className={styles.list}>
      {['first', 'second'].map((row) => (
        <li key={row} className={styles.rowSkeleton}>
          <Bone shape="heading" width="half" />
          <Bone shape="small" width="short" />
        </li>
      ))}
    </ul>
  </Loading>
)

const summaryOf = (reports: readonly BugReport[]): string => {
  const fresh = reports.filter(({ status }) => status === BUG_REPORT_STATUSES.new).length
  return BUG_REPORTS_COPY.summary({
    reports: plural({
      n: reports.length,
      one: BUG_REPORTS_COPY.report,
      many: BUG_REPORTS_COPY.reports,
    }),
    fresh,
  })
}

type ArchiveFixedProps = { fixed: number }

/** Archives every fixed report on the current list at once. */
const ArchiveFixed = ({ fixed }: ArchiveFixedProps) => {
  const archiveFixed = useReportsChange({
    mutationFn: () => api.archiveBugReportsByStatus({ status: BUG_REPORT_STATUSES.fixed }),
    change: (reports) => {
      const at = new Date().toISOString()
      return reports.map((report) =>
        report.status === BUG_REPORT_STATUSES.fixed && report.archivedAt === null
          ? { ...report, archivedAt: at }
          : report,
      )
    },
  })
  return (
    <div className={styles.bulk}>
      <Button
        icon="archive"
        disabled={archiveFixed.isPending}
        onClick={() => archiveFixed.mutate(undefined)}
      >
        {BUG_REPORTS_COPY.archiveAllFixed(fixed)}
      </Button>
      {archiveFixed.isError && (
        <p className={styles.actionError} role="alert">
          {BUG_REPORTS_COPY.archiveFixedFailed}
          {archiveFixed.error.message}
        </p>
      )}
    </div>
  )
}

type ReportsTabsProps = { byTab: ReportsByTab }

/** The current reports and the archived ones, each on its own tab, the current first. */
const ReportsTabs = ({ byTab }: ReportsTabsProps) => {
  const [tab, setTab] = useState<ReportTab>(REPORT_TABS.current)
  const shown = byTab[tab]
  const fixed = shown.filter(({ status }) => status === BUG_REPORT_STATUSES.fixed).length
  return (
    <Tabs
      label={BUG_REPORTS_COPY.tabs}
      tabs={Object.values(REPORT_TABS).map((value) => ({
        value,
        label: BUG_REPORT_TAB_COPY[value],
        count: byTab[value].length,
      }))}
      chosen={tab}
      onChoose={setTab}
    >
      <div className={styles.panel}>
        {tab === REPORT_TABS.current && fixed > 0 && <ArchiveFixed fixed={fixed} />}
        {shown.length === 0 && <p className={styles.empty}>{BUG_REPORT_EMPTY_COPY[tab]}</p>}
        {shown.length > 0 && (
          <ul className={styles.list}>
            {shown.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </ul>
        )}
      </div>
    </Tabs>
  )
}

/** The reports, newest first, with how many are current and how many of those are new; an empty tab says so itself. */
const ReportsList = () => {
  const reports = useQuery(bugReportsQuery)
  const byTab = reports.data && reportsByTab(reports.data)
  const current = byTab?.[REPORT_TABS.current] ?? []
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <hgroup className={styles.heading}>
          <PageTitle icon="alert">{BUG_REPORTS_COPY.title}</PageTitle>
          {current.length > 0 && <p className={styles.summary}>{summaryOf(current)}</p>}
        </hgroup>
      </header>
      {reports.isError && (
        <p role="alert">
          {BUG_REPORTS_COPY.serverDidNotAnswer}
          {reports.error.message}
        </p>
      )}
      {reports.isPending && <RowsSkeleton />}
      {!!byTab && <ReportsTabs byTab={byTab} />}
    </section>
  )
}

/**
 * `/reports`: what viewers sent with Report this error when a video would
 * not play, newest first, for the admin to work through and archive, and
 * then delete from the archive. It is for the
 * admin, or the owner once accounts are on, so it asks only while the
 * viewer may manage, and says so otherwise.
 */
export const BugReportsPage = () => (
  <ForManagers
    name={BUG_REPORTS_COPY.title}
    forAdmin={BUG_REPORTS_COPY.managersOnlyFor}
    forOwner={BUG_REPORTS_COPY.managersOnlyFor}
  >
    <ReportsList />
  </ForManagers>
)
