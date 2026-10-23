import {
  DESKTOP_REQUESTS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadGroup,
  type DownloadView,
  formatBytes,
  type SpaceView,
} from '@raven/core'
import { Button, type IconName } from '@raven/ui'
import { useId, useRef } from 'react'
import {
  type DownloadsChange,
  isInProgress,
  useChangeDownloads,
  useDownloads,
  useSpace,
} from '@/desktop/downloadsApi'
import { handled } from '@/desktop/handled'
import { DownloadRow } from '@/desktop/DownloadsPage/DownloadRow'
import styles from '@/desktop/DownloadsPage/DownloadsPage.module.scss'

const EMPTY = 'Nothing downloaded yet. Choose Download on a movie, show or saga to keep it here.'

/** The header's buttons for every download at once. */
const BULKS = { pauseAll: 'pauseAll', resumeAll: 'resumeAll' } as const

type Bulk = (typeof BULKS)[keyof typeof BULKS]

const BULK_BUTTONS = {
  pauseAll: {
    label: 'Pause all',
    icon: 'pause',
    request: { type: DESKTOP_REQUESTS.pauseAllDownloads },
  },
  resumeAll: {
    label: 'Resume all',
    icon: 'download',
    request: { type: DESKTOP_REQUESTS.resumeAllDownloads },
  },
} as const satisfies Record<Bulk, { label: string; icon: IconName; request: DownloadsChange }>

/** Pause all while anything is queued or downloading, and Resume all while anything waits paused. */
const bulksOf = (downloads: DownloadView[]): Bulk[] => [
  ...(downloads.some(isInProgress) ? [BULKS.pauseAll] : []),
  ...(downloads.some((view) => view.status.kind === DOWNLOAD_STATUS_KINDS.paused)
    ? [BULKS.resumeAll]
    : []),
]

const spaceLine = ({ used, free, total }: SpaceView): string =>
  `${formatBytes(used)} of downloads · ${formatBytes(free)} free of ${formatBytes(total)}`

type Grouped = { group: DownloadGroup; views: DownloadView[] }

/** The downloads by title, in the order main lists them, each title's files in play order. */
const groupsOf = (downloads: DownloadView[]): Grouped[] =>
  [...new Set(downloads.map((view) => view.group.key))].flatMap((key) => {
    const views = downloads
      .filter((view) => view.group.key === key)
      .toSorted((left, right) => left.group.order - right.group.order)
    const first = views[0]
    return first === undefined ? [] : [{ group: first.group, views }]
  })

/** A title's downloads under its name; a movie on its own is its own heading. */
const Group = ({ grouped, onDeleted }: { grouped: Grouped; onDeleted: () => void }) => {
  const headingId = useId()
  const { group, views } = grouped
  const isOwnTitle = views.length === 1 && (views[0]?.label ?? null) === group.title
  return (
    <li className={styles.group}>
      <section aria-labelledby={isOwnTitle ? undefined : headingId} className={styles.groupBody}>
        {!isOwnTitle && (
          <h2 id={headingId} className={styles.groupTitle}>
            {group.title}
          </h2>
        )}
        <ul className={styles.rows}>
          {views.map((view) => (
            <DownloadRow key={view.downloadId} view={view} onDeleted={onDeleted} />
          ))}
        </ul>
      </section>
    </li>
  )
}

/** Every title Raven has downloaded or is downloading, and the disk they are kept on. */
export const DownloadsPage = () => {
  const downloads = useDownloads()
  const space = useSpace()
  const change = useChangeDownloads()
  const title = useRef<HTMLHeadingElement>(null)
  const ids = { title: useId(), line: useId() }

  const focusTitle = () => title.current?.focus()

  const list = downloads.data?.downloads ?? null
  const bulks = bulksOf(list ?? [])
  const disk = space.data ?? null

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <header className={styles.header}>
        <h1 id={ids.title} ref={title} tabIndex={-1} className={styles.title}>
          Downloads
        </h1>
        <div className={styles.tools}>
          {bulks.map((bulk) => (
            <Button
              key={bulk}
              icon={BULK_BUTTONS[bulk].icon}
              onClick={() => handled(change(BULK_BUTTONS[bulk].request))}
            >
              {BULK_BUTTONS[bulk].label}
            </Button>
          ))}
          <Button
            icon="folder"
            onClick={() => handled(change({ type: DESKTOP_REQUESTS.showDownloadsFolder }))}
          >
            Show in Finder
          </Button>
        </div>
        {disk !== null && (
          <div className={styles.disk}>
            <p id={ids.line} className={styles.line}>
              {spaceLine(disk)}
            </p>
            <meter
              className={styles.meter}
              min={0}
              max={disk.total}
              value={disk.used}
              aria-label="Disk"
              aria-describedby={ids.line}
            />
          </div>
        )}
        {disk === null && space.isError && <p className={styles.line}>{space.error.message}</p>}
      </header>
      {list === null && downloads.isError && <p role="alert">{downloads.error.message}</p>}
      {list !== null && list.length === 0 && <p className={styles.empty}>{EMPTY}</p>}
      {list !== null && list.length > 0 && (
        <ul className={styles.groups}>
          {groupsOf(list).map((grouped) => (
            <Group key={grouped.group.key} grouped={grouped} onDeleted={focusTitle} />
          ))}
        </ul>
      )}
    </section>
  )
}
