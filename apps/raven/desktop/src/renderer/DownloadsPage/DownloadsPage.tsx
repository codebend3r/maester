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
import type { DownloadView, SpaceView } from '@/shared/protocol'

const EMPTY =
  'Nothing downloaded yet. Open a title in raven on the web and choose Download to raven player.'

/** The header's one button for every download at once. */
type Bulk = { name: 'Pause all' | 'Resume all'; icon: IconName; request: DownloadsChange }

/** Pause all while anything runs, else Resume all while anything waits paused, else nothing. */
const bulkOf = (downloads: DownloadView[]): Bulk | null => {
  if (downloads.some(isInProgress)) {
    return { name: 'Pause all', icon: 'pause', request: { type: 'pauseAllDownloads' } }
  }
  if (downloads.some((view) => view.status.kind === 'paused')) {
    return { name: 'Resume all', icon: 'download', request: { type: 'resumeAllDownloads' } }
  }
  return null
}

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
  const bulk = bulkOf(list ?? [])
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
        {bulk !== null && (
          <Button
            className={styles.bulk}
            icon={bulk.icon}
            onClick={() => void change(bulk.request)}
          >
            {bulk.name}
          </Button>
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
