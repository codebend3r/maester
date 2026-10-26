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
import { useId, useState } from 'react'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ManagersOnly } from '@/components/ManagersOnly/ManagersOnly'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { copyText } from '@/lib/clipboard'
import { useManagement } from '@/lib/management'
import { api } from '@/lib/api'
import { bugReportsQuery } from '@/lib/queries'
import styles from '@/pages/BugReportsPage/BugReportsPage.module.scss'

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
    `raven bug report #${report.id}`,
    `Status: ${STATUS_LABELS[report.status]}`,
    `Reported: ${report.createdAt}`,
    `Reported by: ${reporterOf(report)} (account ${report.reporter.accountId})`,
    `Title: ${report.title}`,
    `Problem: ${report.summary}`,
    `Media id: ${report.mediaId ?? 'none'}`,
    '',
    'Diagnostics:',
    JSON.stringify(report.diagnostics, null, 2),
  ].join('\n')

const MODE_LABELS = {
  [PLAYBACK_MODES.direct]: 'Direct play',
  [PLAYBACK_MODES.remux]: 'Remux',
  [PLAYBACK_MODES.transcode]: 'Transcode',
} as const satisfies Record<PlaybackMode, string>

/** The ways that were tried and failed, in order; null when none got as far as starting. */
const triedWords = (modes: readonly PlaybackMode[]): string | null =>
  modes.length === 0 ? null : modes.map((mode) => MODE_LABELS[mode]).join(', then ')

/** The facts worth a glance before the full diagnostics; none from a report this page cannot read. */
const glanceFacts = (report: BugReport): Array<{ name: string; value: string }> => {
  const { diagnostics } = report
  if (!isPlaybackDiagnostics(diagnostics)) return []
  const tried = triedWords(diagnostics.playback?.attempts.map(({ mode }) => mode) ?? [])
  return [
    { name: 'File', value: diagnostics.media?.fileName ?? 'Not a library file' },
    { name: 'Tried', value: tried ?? 'Nothing, it could not start' },
    { name: 'Browser', value: diagnostics.device.userAgent },
  ]
}

const COPY_FEEDBACK = {
  copied: 'Debug info copied.',
  failed: 'Could not copy. Open Debug info and copy it from there.',
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
        {' by '}
        {reporterOf(report)}
      </p>
      <p className={styles.problem}>
        {report.summary === '' ? 'No problem was listed.' : report.summary}
      </p>
      <div className={styles.status}>
        <label htmlFor={statusId}>
          Status<span className="visually-hidden"> of report {report.id}</span>
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
          Copy debug info
        </Button>
        <p className={styles.feedback} aria-live="polite">
          {copied}
        </p>
      </div>
      {status.isError && (
        <p className={styles.error} role="alert">
          Could not change its status: {status.error.message}
        </p>
      )}
      <details className={styles.details}>
        <summary>Debug info</summary>
        <pre className={styles.json}>{JSON.stringify(report.diagnostics, null, 2)}</pre>
      </details>
    </li>
  )
}

/** Two cards on their way. */
const RowsSkeleton = () => (
  <Loading label="Looking for bug reports">
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
  if (reports.length === 0) return 'Nothing has been reported'
  const fresh = reports.filter(({ status }) => status === BUG_REPORT_STATUSES.new).length
  return `${plural({ n: reports.length, one: 'report', many: 'reports' })}, ${fresh} new`
}

/**
 * `/reports`: what viewers sent with Report this error when a video would
 * not play, newest first, for the admin to work through. It is for the
 * admin, or the owner once accounts are on, so it asks only while the
 * viewer may manage, and says so otherwise.
 */
export const BugReportsPage = () => {
  const { mode, canManage } = useManagement()
  const reports = useQuery({ ...bugReportsQuery, enabled: canManage })

  if (!canManage) {
    return (
      <ManagersOnly
        mode={mode}
        name="Bug reports"
        forAdmin="read what viewers reported"
        forOwner="read what viewers reported"
      />
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <hgroup className={styles.heading}>
          <h1>Bug reports</h1>
          {reports.data && <p className={styles.summary}>{summaryOf(reports.data)}</p>}
        </hgroup>
      </header>
      {reports.isError && <p role="alert">The server did not answer: {reports.error.message}</p>}
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
