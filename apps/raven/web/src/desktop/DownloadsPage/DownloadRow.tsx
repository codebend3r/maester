import {
  DESKTOP_REQUESTS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadStatus,
  type DownloadView,
  formatBytes,
  KEYS,
} from '@raven/core'
import { Button, type IconName, UNLOCK_SECRETS, UnlockDialog } from '@raven/ui'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { handled } from '@/desktop/handled'
import { useChangeDownloads } from '@/desktop/downloadsApi'
import { useOpenReply } from '@/desktop/openReply'
import { watchedLabel } from '@/desktop/watched'
import { api } from '@/lib/api'
import { useDesktop } from '@/stores/desktop'
import styles from '@/desktop/DownloadsPage/DownloadsPage.module.scss'

/** What a row shows: the download, or the question before it is deleted. */
const ROW_MODES = { view: 'view', delete: 'delete' } as const

type RowMode = (typeof ROW_MODES)[keyof typeof ROW_MODES]

/** The one action a row's status allows beside Delete. */
const ROW_ACTIONS = { play: 'play', pause: 'pause', resume: 'resume', retry: 'retry' } as const

type RowAction = (typeof ROW_ACTIONS)[keyof typeof ROW_ACTIONS]

/** Each action's button: its words and its icon. */
const ACTION_BUTTONS = {
  play: { label: 'Play', icon: 'play' },
  pause: { label: 'Pause', icon: 'pause' },
  resume: { label: 'Resume', icon: 'download' },
  retry: { label: 'Retry', icon: 'rescan' },
} as const satisfies Record<RowAction, { label: string; icon: IconName }>

const actionOf = (status: DownloadStatus): RowAction => {
  switch (status.kind) {
    case DOWNLOAD_STATUS_KINDS.ready:
      return ROW_ACTIONS.play
    case DOWNLOAD_STATUS_KINDS.queued:
    case DOWNLOAD_STATUS_KINDS.downloading:
      return ROW_ACTIONS.pause
    case DOWNLOAD_STATUS_KINDS.paused:
      return ROW_ACTIONS.resume
    case DOWNLOAD_STATUS_KINDS.failed:
      return ROW_ACTIONS.retry
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

const MINUTE_MS = 60_000

/** How often the line is read again: well inside a minute, so it is never a minute behind. */
const DELETES_TICK_MS = 10_000

const deletesInWords = (minutes: number): string =>
  minutes === 1 ? 'Deletes in 1 minute' : `Deletes in ${minutes} minutes`

type DeletesInProps = { at: number }

/** How long until a download set to delete once watched goes, in whole minutes rounded up. */
const DeletesIn = ({ at }: DeletesInProps) => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), DELETES_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const minutes = Math.ceil((at - now) / MINUTE_MS)
  return minutes > 0 && <span>{deletesInWords(minutes)}</span>
}

type StatusLineProps = { view: DownloadView; textId: string }

/** Where a download stands: its progress, its wait, why it stopped, or how much of it was watched. */
const StatusLine = ({ view, textId }: StatusLineProps) => {
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

type DownloadRowProps = {
  view: DownloadView
  /** The row is gone with its buttons, so the page takes the focus. */
  onDeleted: () => void
}

/** One downloaded file: what it is, where it stands, and what can be done with it. */
export const DownloadRow = ({ view, onDeleted }: DownloadRowProps) => {
  const { client } = useDesktop()
  const change = useChangeDownloads()
  const openReply = useOpenReply()
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
  const actionButton = ACTION_BUTTONS[action]

  // Focus follows the swap: into the question, then back to Delete, unless the person moved on.
  useEffect(() => {
    const previous = previousMode.current
    previousMode.current = mode
    if (mode === ROW_MODES.delete) return cancelButton.current?.focus()
    if (previous === ROW_MODES.view) return
    const active = document.activeElement
    const isFocusLost = active === null || active === document.body
    if (!isFocusLost && !(row.current?.contains(active) ?? false)) return
    deleteButton.current?.focus()
  }, [mode])

  const act = async (): Promise<unknown> => {
    switch (action) {
      case ROW_ACTIONS.play:
        return openReply(await client.request({ type: DESKTOP_REQUESTS.openDownload, downloadId }))
      case ROW_ACTIONS.pause:
        return change({ type: DESKTOP_REQUESTS.pauseDownload, downloadId })
      case ROW_ACTIONS.resume:
        // A library locked again needs its PIN before main can fetch from it.
        if (view.isLocked) return setIsUnlocking(true)
        return change({ type: DESKTOP_REQUESTS.resumeDownload, downloadId })
      case ROW_ACTIONS.retry:
        return change({ type: DESKTOP_REQUESTS.retryDownload, downloadId })
      default: {
        const unreachable: never = action
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

  return (
    <li ref={row} className={styles.card}>
      {mode === ROW_MODES.delete ? (
        <div className={styles.asking}>
          <p id={ids.question} className={styles.question}>
            {`Delete ${label}? ${formatBytes(bytesOnDisk(view))} will be freed.`}
          </p>
          <div className={styles.confirm}>
            {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
            <Button
              tone="danger"
              aria-describedby={ids.question}
              aria-disabled={isDeleting}
              onClick={() => handled(remove())}
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
        </div>
      ) : (
        <div className={styles.row}>
          <span id={ids.label} className={styles.label}>
            {label}
          </span>
          <span className={styles.size}>{formatBytes(view.size)}</span>
          <p className={styles.status}>
            <StatusLine view={view} textId={ids.status} />
          </p>
          <div className={styles.actions}>
            <Button
              className={styles.act}
              tone={action === ROW_ACTIONS.play ? 'primary' : 'quiet'}
              icon={actionButton.icon}
              aria-label={`${actionButton.label} ${label}`}
              onClick={() => handled(act())}
            >
              {actionButton.label}
            </Button>
            <label className={styles.auto}>
              <input
                type="checkbox"
                role="switch"
                checked={view.shouldAutoDelete}
                aria-checked={view.shouldAutoDelete}
                aria-describedby={ids.label}
                onChange={(event) =>
                  handled(
                    change({
                      type: DESKTOP_REQUESTS.setDownloadAutoDelete,
                      downloadId,
                      shouldAutoDelete: event.target.checked,
                    }),
                  )
                }
              />
              Delete once watched
            </label>
            <Button
              ref={deleteButton}
              className={styles.remove}
              tone="ghost"
              icon="trash"
              aria-label={`Delete ${label}`}
              onClick={() => setMode(ROW_MODES.delete)}
            />
          </div>
        </div>
      )}
      {isUnlocking && (
        <UnlockDialog
          secret={UNLOCK_SECRETS.pin}
          hint="This download is in a locked library. Enter the PIN to go on downloading it."
          unlock={(entered) => api.unlock(entered)}
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
