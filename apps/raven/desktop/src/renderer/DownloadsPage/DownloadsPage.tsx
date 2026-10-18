import { formatBytes } from '@raven/core'
import { Button, type IconName } from '@raven/ui'
import { useEffect, useId, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  type DownloadsChange,
  isInProgress,
  useChangeDownloads,
  useDownloads,
  useSpace,
} from '@/renderer/desktop/downloadsApi'
import { DownloadRow } from '@/renderer/DownloadsPage/DownloadRow'
import styles from '@/renderer/DownloadsPage/DownloadsPage.module.scss'
import {
  DESKTOP_REQUESTS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadView,
  type SpaceView,
} from '@/shared/protocol'

const EMPTY =
  'Nothing downloaded yet. Open a title in raven on the web and choose Download to raven player.'

/** A header button for every download at once. */
type Bulk = { name: 'Pause all' | 'Resume all'; icon: IconName; request: DownloadsChange }

const PAUSE_ALL: Bulk = {
  name: 'Pause all',
  icon: 'pause',
  request: { type: DESKTOP_REQUESTS.pauseAllDownloads },
}

const RESUME_ALL: Bulk = {
  name: 'Resume all',
  icon: 'download',
  request: { type: DESKTOP_REQUESTS.resumeAllDownloads },
}

/** Pause all while anything is queued or downloading, and Resume all while anything waits paused. */
const bulksOf = (downloads: DownloadView[]): Bulk[] => [
  ...(downloads.some(isInProgress) ? [PAUSE_ALL] : []),
  ...(downloads.some((view) => view.status.kind === DOWNLOAD_STATUS_KINDS.paused)
    ? [RESUME_ALL]
    : []),
]

const spaceLine = ({ used, free, total }: SpaceView): string =>
  `${formatBytes(used)} of downloads · ${formatBytes(free)} free of ${formatBytes(total)}`

/** Every file raven player has downloaded or is downloading, and the disk they are kept on. */
export const DownloadsPage = () => {
  const navigate = useNavigate()
  const downloads = useDownloads()
  const space = useSpace()
  const change = useChangeDownloads()
  const title = useRef<HTMLHeadingElement>(null)
  const lineId = useId()

  const focusTitle = () => {
    if (title.current !== null) title.current.focus()
  }

  useEffect(() => {
    if (title.current !== null) title.current.focus()
  }, [])

  const list = downloads.data?.downloads ?? null
  const bulks = bulksOf(list ?? [])
  const disk = space.data ?? null

  return (
    <main className={styles.downloads} aria-labelledby="downloads-title">
      <header className={styles.bar}>
        <Button className={styles.back} icon="back" onClick={() => void navigate('/')}>
          Back
        </Button>
        <h1 id="downloads-title" className={styles.title} tabIndex={-1} ref={title}>
          Downloads
        </h1>
        {bulks.length > 0 && (
          <div className={styles.bulk}>
            {bulks.map((bulk) => (
              <Button key={bulk.name} icon={bulk.icon} onClick={() => void change(bulk.request)}>
                {bulk.name}
              </Button>
            ))}
          </div>
        )}
        {disk !== null && (
          <>
            <p id={lineId} className={styles.line}>
              {spaceLine(disk)}
            </p>
            <meter
              className={styles.meter}
              min={0}
              max={disk.total}
              value={disk.used}
              aria-label="Disk"
              aria-describedby={lineId}
            />
          </>
        )}
        {disk === null && space.isError && <p className={styles.line}>{space.error.message}</p>}
      </header>
      {list === null && downloads.isError && (
        <p className={styles.note} role="alert">
          {downloads.error.message}
        </p>
      )}
      {list !== null && list.length === 0 && <p className={styles.note}>{EMPTY}</p>}
      {list !== null && list.length > 0 && (
        <ul className={styles.list}>
          {list.map((view) => (
            <DownloadRow key={view.downloadId} view={view} onDeleted={focusTitle} />
          ))}
        </ul>
      )}
    </main>
  )
}
