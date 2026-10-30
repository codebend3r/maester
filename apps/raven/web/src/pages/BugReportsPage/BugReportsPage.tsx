import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BUG_REPORT_STATUSES,
  type BugReport,
  type BugReportStatus,
  PLAYBACK_MODES,
  type PlaybackMode,
  isBugReportStatus,
  isPlaybackDiagnostics,
  plural,
} from '@raven/core'
import { Button } from '@raven/ui'
import { type ComponentType, useId, useState } from 'react'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ManagersOnly } from '@/components/ManagersOnly/ManagersOnly'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { copyText } from '@/lib/clipboard'
import { useManagement } from '@/lib/management'
import { api } from '@/lib/api'
import { bugReportsQuery } from '@/lib/queries'
import { BUG_REPORTS_COPY } from '@/pages/BugReportsPage/copy'
import styles from '@/pages/BugReportsPage/BugReportsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'

const STATUS_LABELS = {
  [BUG_REPORT_STATUSES.new]: 'New',
  [BUG_REPORT_STATUSES.investigating]: 'Investigating',
  [BUG_REPORT_STATUSES.fixed]: 'Fixed',
  [BUG_REPORT_STATUSES.wontFix]: "Won't fix",
} as const satisfies Record<BugReportStatus, string>

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

const MODE_LABELS = {
  [PLAYBACK_MODES.direct]: 'Direct play',
  [PLAYBACK_MODES.remux]: 'Remux',
  [PLAYBACK_MODES.transcode]: 'Transcode',
} as const satisfies Record<PlaybackMode, string>

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

type ReportRowProps = { report: BugReport }

/**
 * One report as a card: what failed and for whom, its status to move on as
 * the admin works through it, and Copy debug info for everything it holds.
 */
const ReportRow = ({ report }: ReportRowProps) => {
  const queryClient = useQueryClient()
  const statusId = useId()
  const [copied, setCopied] = useState<CopyFeedback | null>(null)
  const { queryKey } = bugReportsQuery
  const status = useMutation({
    mutationFn: (next: BugReportStatus) => api.setBugReportStatus({ id: report.id, status: next }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey })
      const before = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(
        queryKey,
        (reports) =>
          reports?.map((shown) => (shown.id === report.id ? { ...shown, status: next } : shown)) ??
          reports,
      )
      return { before }
    },
    onError: (_error, _next, context) => {
      if (context) queryClient.setQueryData(queryKey, context.before)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
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
  if (reports.length === 0) return BUG_REPORTS_COPY.nothingReported
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

type BugReportsViewProps = { mode: ReturnType<typeof useManagement>['mode'] }

type NotManagingProps = BugReportsViewProps

const NotManaging = ({ mode }: NotManagingProps) => (
  <ManagersOnly
    mode={mode}
    name={BUG_REPORTS_COPY.title}
    forAdmin={BUG_REPORTS_COPY.managersOnlyFor}
    forOwner={BUG_REPORTS_COPY.managersOnlyFor}
  />
)

/** The reports, newest first, with how many there are and how many are new. */
const ReportsList = () => {
  const reports = useQuery(bugReportsQuery)
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <hgroup className={styles.heading}>
          <PageTitle icon="alert">{BUG_REPORTS_COPY.title}</PageTitle>
          {reports.data && <p className={styles.summary}>{summaryOf(reports.data)}</p>}
        </hgroup>
      </header>
      {reports.isError && (
        <p role="alert">
          {BUG_REPORTS_COPY.serverDidNotAnswer}
          {reports.error.message}
        </p>
      )}
      {reports.isPending && <RowsSkeleton />}
      {reports.data && reports.data.length > 0 && (
        <ul className={styles.list}>
          {reports.data.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      )}
    </section>
  )
}

const MANAGE_STATES = { managing: 'managing', refused: 'refused' } as const
type ManageState = (typeof MANAGE_STATES)[keyof typeof MANAGE_STATES]

const BUG_REPORTS_VIEWS = {
  [MANAGE_STATES.managing]: ReportsList,
  [MANAGE_STATES.refused]: NotManaging,
} as const satisfies Record<ManageState, ComponentType<BugReportsViewProps>>

/**
 * `/reports`: what viewers sent with Report this error when a video would
 * not play, newest first, for the admin to work through. It is for the
 * admin, or the owner once accounts are on, so it asks only while the
 * viewer may manage, and says so otherwise.
 */
export const BugReportsPage = () => {
  const { mode, canManage } = useManagement()
  const View = BUG_REPORTS_VIEWS[canManage ? MANAGE_STATES.managing : MANAGE_STATES.refused]
  return <View mode={mode} />
}
