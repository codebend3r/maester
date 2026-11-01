import {
  DESKTOP_REQUESTS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadGroup,
  type DownloadView,
  type SpaceView,
} from '@raven/core'
import { Button, type IconName } from '@raven/ui'
import { type ComponentType, useId, useRef, useState } from 'react'
import {
  type DownloadsChange,
  isInProgress,
  useChangeDownloads,
  useDownloads,
  useSpace,
} from '@/desktop/downloadsApi'
import { handled } from '@/desktop/handled'
import { DOWNLOADS_PAGE_COPY } from '@/desktop/DownloadsPage/copy'
import { DownloadActivity } from '@/desktop/DownloadsPage/DownloadActivity'
import { DownloadRow } from '@/desktop/DownloadsPage/DownloadRow'
import { DownloadsWatch } from '@/desktop/DownloadsPage/DownloadsWatch'
import { useTotalSpeed } from '@/desktop/useDownloadSpeed'
import { Tabs } from '@/components/Tabs/Tabs'
import styles from '@/desktop/DownloadsPage/DownloadsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'

/** The header's buttons for every download at once. */
const BULKS = { pauseAll: 'pauseAll', resumeAll: 'resumeAll' } as const

type Bulk = (typeof BULKS)[keyof typeof BULKS]

const BULK_BUTTONS = {
  pauseAll: {
    label: DOWNLOADS_PAGE_COPY.pauseAll,
    icon: 'pause',
    request: { type: DESKTOP_REQUESTS.pauseAllDownloads },
  },
  resumeAll: {
    label: DOWNLOADS_PAGE_COPY.resumeAll,
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

type GroupProps = { grouped: Grouped; onDeleted: () => void }

/** A title's downloads under its name; a movie on its own is its own heading. */
const Group = ({ grouped, onDeleted }: GroupProps) => {
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

/** Where a query the page reads stands: on its way, refused, or answered (empty or not). */
const READ_STATES = {
  waiting: 'waiting',
  failed: 'failed',
  empty: 'empty',
  listed: 'listed',
} as const

type ReadState = (typeof READ_STATES)[keyof typeof READ_STATES]

type ReadStateOfProps = { isRead: boolean; isEmpty: boolean; isError: boolean }

const readStateOf = ({ isRead, isEmpty, isError }: ReadStateOfProps): ReadState => {
  if (!isRead) return isError ? READ_STATES.failed : READ_STATES.waiting
  return isEmpty ? READ_STATES.empty : READ_STATES.listed
}

const Unread = () => null

type ListViewProps = { list: DownloadView[]; error: string | null; onDeleted: () => void }

type ListFailedProps = ListViewProps

const ListFailed = ({ error }: ListFailedProps) => <p role="alert">{error}</p>

const ListEmpty = () => <p className={styles.empty}>{DOWNLOADS_PAGE_COPY.empty}</p>

type ListedProps = ListViewProps

const Listed = ({ list, onDeleted }: ListedProps) => (
  <ul className={styles.groups}>
    {groupsOf(list).map((grouped) => (
      <Group key={grouped.group.key} grouped={grouped} onDeleted={onDeleted} />
    ))}
  </ul>
)

const LIST_VIEWS = {
  [READ_STATES.waiting]: Unread,
  [READ_STATES.failed]: ListFailed,
  [READ_STATES.empty]: ListEmpty,
  [READ_STATES.listed]: Listed,
} as const satisfies Record<ReadState, ComponentType<ListViewProps>>

type WatchListedProps = ListViewProps

const WatchListed = ({ list }: WatchListedProps) => <DownloadsWatch downloads={list} />

const WATCH_VIEWS = {
  [READ_STATES.waiting]: Unread,
  [READ_STATES.failed]: ListFailed,
  [READ_STATES.empty]: ListEmpty,
  [READ_STATES.listed]: WatchListed,
} as const satisfies Record<ReadState, ComponentType<ListViewProps>>

/** The page's two views of the same downloads: the list to manage them, and the grid to watch. */
const PAGE_TABS = { manage: 'manage', watch: 'watch' } as const

type PageTab = (typeof PAGE_TABS)[keyof typeof PAGE_TABS]

const TAB_VIEWS = {
  [PAGE_TABS.manage]: LIST_VIEWS,
  [PAGE_TABS.watch]: WATCH_VIEWS,
} as const satisfies Record<PageTab, Record<ReadState, ComponentType<ListViewProps>>>

const TAB_LABELS = {
  [PAGE_TABS.manage]: DOWNLOADS_PAGE_COPY.manage,
  [PAGE_TABS.watch]: DOWNLOADS_PAGE_COPY.watch,
} as const satisfies Record<PageTab, string>

type ActivityProps = { downloads: DownloadView[] }

const bytesSoFar = ({ status }: DownloadView): number =>
  status.kind === DOWNLOAD_STATUS_KINDS.downloading ? status.bytes : 0

/** What is downloading and how fast, over a bar that keeps moving while any of it does. */
const Activity = ({ downloads }: ActivityProps) => {
  const speed = useTotalSpeed()
  const active = downloads.filter(isInProgress)
  const label = DOWNLOADS_PAGE_COPY.activity({ files: active.length, speed })
  return (
    active.length > 0 && (
      <div className={styles.activity}>
        <p className={styles.line}>{label}</p>
        <DownloadActivity
          value={active.reduce((sum, view) => sum + bytesSoFar(view), 0)}
          max={active.reduce((sum, view) => sum + view.size, 0)}
          label={label}
        />
      </div>
    )
  )
}

type DiskViewProps = { disk: SpaceView | null; error: string | null; lineId: string }

type DiskFailedProps = DiskViewProps

const DiskFailed = ({ error }: DiskFailedProps) => <p className={styles.line}>{error}</p>

type DiskProps = DiskViewProps

const Disk = ({ disk, lineId }: DiskProps) =>
  disk !== null && (
    <div className={styles.disk}>
      <p id={lineId} className={styles.line}>
        {DOWNLOADS_PAGE_COPY.space(disk)}
      </p>
      <meter
        className={styles.meter}
        min={0}
        max={disk.total}
        value={disk.used}
        aria-label={DOWNLOADS_PAGE_COPY.disk}
        aria-describedby={lineId}
      />
    </div>
  )

/** A disk is never empty: once read, it is shown. */
const DISK_VIEWS = {
  [READ_STATES.waiting]: Unread,
  [READ_STATES.failed]: DiskFailed,
  [READ_STATES.empty]: Disk,
  [READ_STATES.listed]: Disk,
} as const satisfies Record<ReadState, ComponentType<DiskViewProps>>

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
  const [tab, setTab] = useState<PageTab>(PAGE_TABS.manage)
  const ListView =
    TAB_VIEWS[tab][
      readStateOf({
        isRead: list !== null,
        isEmpty: list !== null && list.length === 0,
        isError: downloads.isError,
      })
    ]
  const DiskView =
    DISK_VIEWS[readStateOf({ isRead: disk !== null, isEmpty: false, isError: space.isError })]

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <header className={styles.header}>
        <PageTitle
          id={ids.title}
          ref={title}
          tabIndex={-1}
          icon="download"
          className={styles.title}
        >
          {COMMON_COPY.downloads}
        </PageTitle>
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
            {DOWNLOADS_PAGE_COPY.showInFinder}
          </Button>
        </div>
        <Activity downloads={list ?? []} />
        <DiskView disk={disk} error={space.error?.message ?? null} lineId={ids.line} />
      </header>
      <Tabs
        label={DOWNLOADS_PAGE_COPY.tabs}
        tabs={Object.values(PAGE_TABS).map((value) => ({
          value,
          label: TAB_LABELS[value],
          count: list?.length ?? 0,
        }))}
        chosen={tab}
        onChoose={setTab}
      >
        <ListView
          list={list ?? []}
          error={downloads.error?.message ?? null}
          onDeleted={focusTitle}
        />
      </Tabs>
    </section>
  )
}
