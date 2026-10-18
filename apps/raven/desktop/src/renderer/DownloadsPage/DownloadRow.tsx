import { formatBytes } from '@raven/core'
import { Button, type IconName, KEYS, UNLOCK_SECRETS, UnlockDialog } from '@raven/ui'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { useDesktop } from '@/renderer/stores/desktop'
import { UNREACHED, useChangeDownloads } from '@/renderer/desktop/downloadsApi'
import { serverApiFor } from '@/renderer/desktop/serverApi'
import { watchedLabel } from '@/renderer/desktop/watched'
import styles from '@/renderer/DownloadsPage/DownloadsPage.module.scss'
import { SERVER_COPY } from '@/renderer/ServerPage/serverServices'
import { useOpenReply } from '@/renderer/Shell/openReply'
import { useNotice } from '@/renderer/stores/notice'
import {
  DESKTOP_REQUESTS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadStatus,
  type DownloadView,
} from '@/shared/protocol'

/** What a row shows: the download, or the question before it is deleted. */
const ROW_MODES = { view: 'view', delete: 'delete' } as const

type RowMode = (typeof ROW_MODES)[keyof typeof ROW_MODES]

/** The one action a row's status allows beside Delete; its name is the button's label. */
const ROW_ACTIONS = { play: 'Play', pause: 'Pause', resume: 'Resume', retry: 'Retry' } as const

type RowAction = { name: (typeof ROW_ACTIONS)[keyof typeof ROW_ACTIONS]; icon: IconName }

const actionOf = (status: DownloadStatus): RowAction => {
  switch (status.kind) {
    case DOWNLOAD_STATUS_KINDS.ready:
      return { name: ROW_ACTIONS.play, icon: 'play' }
    case DOWNLOAD_STATUS_KINDS.queued:
    case DOWNLOAD_STATUS_KINDS.downloading:
      return { name: ROW_ACTIONS.pause, icon: 'pause' }
    case DOWNLOAD_STATUS_KINDS.paused:
      return { name: ROW_ACTIONS.resume, icon: 'download' }
    case DOWNLOAD_STATUS_KINDS.failed:
      return { name: ROW_ACTIONS.retry, icon: 'rescan' }
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

/** What deleting the row frees: the whole file once ready, else what its status says is on disk. */
const bytesOnDisk = ({ status, size }: DownloadView): number => {
  switch (status.kind) {
    case DOWNLOAD_STATUS_KINDS.ready:
      return size
    case DOWNLOAD_STATUS_KINDS.queued:
      return 0
    case DOWNLOAD_STATUS_KINDS.downloading:
    case DOWNLOAD_STATUS_KINDS.paused:
    case DOWNLOAD_STATUS_KINDS.failed:
      return status.bytes
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

const focus = (element: HTMLElement | null) => {
  if (element !== null) element.focus()
}

const MINUTE_MS = 60_000

/** How often the line is read again: well inside a minute, so it is never a minute behind. */
const DELETES_TICK_MS = 10_000

const deletesInWords = (minutes: number): string =>
  minutes === 1 ? 'Deletes in 1 minute' : `Deletes in ${minutes} minutes`

/** How long until a download set to delete once watched goes, in whole minutes rounded up. */
const DeletesIn = ({ at }: { at: number }) => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), DELETES_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const minutes = Math.ceil((at - now) / MINUTE_MS)
  if (minutes <= 0) return null
  return <span>{deletesInWords(minutes)}</span>
}

/** Where a download stands: its progress, its wait, why it stopped, or how much of it was watched. */
const StatusLine = ({ view, textId }: { view: DownloadView; textId: string }) => {
  const { status } = view
  switch (status.kind) {
    case DOWNLOAD_STATUS_KINDS.downloading:
      return (
        <>
          <span id={textId}>{`${formatBytes(status.bytes)} of ${formatBytes(view.size)}`}</span>
          <progress
            className={styles.gauge}
            max={view.size}
            value={status.bytes}
            aria-labelledby={textId}
          />
        </>
      )
    case DOWNLOAD_STATUS_KINDS.queued:
      return <span>Waiting</span>
    case DOWNLOAD_STATUS_KINDS.paused:
      return <span>{status.message ?? 'Paused'}</span>
    case DOWNLOAD_STATUS_KINDS.failed:
      return <span>{`Failed: ${status.message}`}</span>
    case DOWNLOAD_STATUS_KINDS.ready:
      return (
        <>
          <progress
            className={styles.gauge}
            max={1}
            value={view.watched ?? 0}
            aria-label={watchedLabel(view.watched)}
          />
          {view.deletesAt !== null && <DeletesIn at={view.deletesAt} />}
        </>
      )
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

/** One downloaded file: what it is, where it stands, and what can be done with it. */
export const DownloadRow = ({
  view,
  onDeleted,
}: {
  view: DownloadView
  /** The row is gone with its buttons, so the page takes the focus. */
  onDeleted: () => void
}) => {
  const { client } = useDesktop()
  const change = useChangeDownloads()
  const openReply = useOpenReply()
  const showNotice = useNotice((state) => state.show)
  const [mode, setMode] = useState<RowMode>(ROW_MODES.view)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const isDeletingNow = useRef(false)
  const row = useRef<HTMLLIElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const previousMode = useRef<RowMode>(mode)
  const ids = { label: useId(), status: useId(), question: useId() }
  const { downloadId, label } = view
  const action = actionOf(view.status)

  // Focus follows the swap: into the question, then back to Delete, unless the person moved on.
  useEffect(() => {
    const previous = previousMode.current
    previousMode.current = mode
    if (mode === ROW_MODES.delete) return focus(cancelButton.current)
    if (previous === ROW_MODES.view) return
    const active = document.activeElement
    const isFocusLost = active === null || active === document.body
    if (!isFocusLost && !(row.current?.contains(active) ?? false)) return
    focus(deleteButton.current)
  }, [mode])

  const play = async () => {
    const reply = await client
      .request({ type: DESKTOP_REQUESTS.openDownload, downloadId })
      .catch(() => null)
    if (reply === null) return showNotice(UNREACHED)
    openReply(reply)
  }

  const act = async () => {
    switch (action.name) {
      case ROW_ACTIONS.play:
        return play()
      case ROW_ACTIONS.pause:
        return change({ type: DESKTOP_REQUESTS.pauseDownload, downloadId })
      case ROW_ACTIONS.resume:
        // A library locked again needs its PIN before main can fetch from it.
        if (view.needsUnlock) return setIsUnlocking(true)
        return change({ type: DESKTOP_REQUESTS.resumeDownload, downloadId })
      case ROW_ACTIONS.retry:
        return change({ type: DESKTOP_REQUESTS.retryDownload, downloadId })
      default: {
        const unreachable: never = action.name
        return unreachable
      }
    }
  }

  const remove = async () => {
    if (isDeletingNow.current) return
    isDeletingNow.current = true
    setIsDeleting(true)
    const isDeleted = await change({ type: DESKTOP_REQUESTS.deleteDownload, downloadId })
    isDeletingNow.current = false
    setIsDeleting(false)
    setMode(ROW_MODES.view)
    if (isDeleted) onDeleted()
  }

  const backOnEscape = (event: KeyboardEvent) => {
    if (event.key !== KEYS.escape) return
    event.preventDefault()
    setMode(ROW_MODES.view)
  }

  // A movie is its own group, so its row names the server alone rather than its title twice.
  const from = [
    ...(view.group.title === label ? [] : [view.group.title]),
    ...(view.serverName === '' ? [] : [view.serverName]),
  ].join(' · ')

  return (
    <li ref={row} className={mode === ROW_MODES.view ? styles.row : styles.asking}>
      {mode === ROW_MODES.delete ? (
        <>
          <p id={ids.question} className={styles.question}>
            {`Delete ${label}? ${formatBytes(bytesOnDisk(view))} will be freed.`}
          </p>
          <div className={styles.confirm}>
            {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
            <Button
              tone="danger"
              aria-describedby={ids.question}
              aria-disabled={isDeleting}
              onClick={() => void remove()}
              onKeyDown={backOnEscape}
            >
              Delete
            </Button>
            <Button
              ref={cancelButton}
              onClick={() => setMode(ROW_MODES.view)}
              onKeyDown={backOnEscape}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <span id={ids.label} className={styles.label}>
            {label}
          </span>
          {from !== '' && <span className={styles.from}>{from}</span>}
          <span className={styles.size}>{formatBytes(view.size)}</span>
          <p className={styles.status}>
            <StatusLine view={view} textId={ids.status} />
          </p>
          <div className={styles.actions}>
            <Button
              className={styles.act}
              tone={action.name === ROW_ACTIONS.play ? 'primary' : 'quiet'}
              icon={action.icon}
              aria-label={`${action.name} ${label}`}
              onClick={() => void act()}
            >
              {action.name}
            </Button>
            <label className={styles.auto}>
              <input
                type="checkbox"
                role="switch"
                checked={view.autoDelete}
                aria-checked={view.autoDelete}
                aria-describedby={ids.label}
                onChange={(event) =>
                  void change({
                    type: DESKTOP_REQUESTS.setDownloadAutoDelete,
                    downloadId,
                    autoDelete: event.target.checked,
                  })
                }
              />
              Delete once watched
            </label>
            <Button
              ref={deleteButton}
              className={styles.remove}
              tone="danger"
              icon="trash"
              aria-label={`Delete ${label}`}
              onClick={() => setMode(ROW_MODES.delete)}
            >
              Delete
            </Button>
          </div>
        </>
      )}
      {isUnlocking && (
        <UnlockDialog
          secret={UNLOCK_SECRETS.pin}
          hint={SERVER_COPY.pinHint(view.serverName)}
          unlock={(entered) => serverApiFor({ client, serverId: view.serverId }).unlock(entered)}
          onUnlocked={() => {
            setIsUnlocking(false)
            return change({ type: DESKTOP_REQUESTS.resumeDownload, downloadId })
          }}
          onClose={() => setIsUnlocking(false)}
        />
      )}
    </li>
  )
}
