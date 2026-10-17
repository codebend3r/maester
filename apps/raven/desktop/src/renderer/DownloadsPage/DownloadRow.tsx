import { formatBytes } from '@raven/core'
import { Button, type IconName, UnlockDialog } from '@raven/ui'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import { UNREACHED, useChangeDownloads } from '@/renderer/desktop/downloadsApi'
import { serverApiFor } from '@/renderer/desktop/serverApi'
import { watchedLabel } from '@/renderer/desktop/watched'
import styles from '@/renderer/DownloadsPage/DownloadsPage.module.scss'
import { SERVER_COPY } from '@/renderer/ServerPage/serverServices'
import { useNotice, useOpenReply } from '@/renderer/Shell/openReply'
import type { DownloadStatus, DownloadView } from '@/shared/protocol'

/** What a row shows: the download, or the question before it is deleted. */
type RowMode = 'view' | 'delete'

/** The one action a row's status allows beside Delete. */
type RowAction = { name: 'Play' | 'Pause' | 'Resume' | 'Retry'; icon: IconName }

const actionOf = (status: DownloadStatus): RowAction => {
  switch (status.kind) {
    case 'ready':
      return { name: 'Play', icon: 'play' }
    case 'queued':
    case 'downloading':
      return { name: 'Pause', icon: 'pause' }
    case 'paused':
      return { name: 'Resume', icon: 'download' }
    case 'failed':
      return { name: 'Retry', icon: 'rescan' }
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

const focus = (element: HTMLElement | null) => {
  if (element !== null) element.focus()
}

/** Where a download stands: its progress, its wait, why it stopped, or how much of it was watched. */
const StatusLine = ({ view, textId }: { view: DownloadView; textId: string }) => {
  const { status } = view
  switch (status.kind) {
    case 'downloading':
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
    case 'queued':
      return <span>Waiting</span>
    case 'paused':
      return <span>{status.message ?? 'Paused'}</span>
    case 'failed':
      return <span>{`Failed: ${status.message}`}</span>
    case 'ready':
      return (
        <progress
          className={styles.gauge}
          max={1}
          value={view.watched ?? 0}
          aria-label={watchedLabel(view.watched)}
        />
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
  const showNotice = useNotice()
  const [mode, setMode] = useState<RowMode>('view')
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
    if (mode === 'delete') return focus(cancelButton.current)
    if (previous === 'view') return
    const active = document.activeElement
    const isFocusLost = active === null || active === document.body
    if (!isFocusLost && !(row.current?.contains(active) ?? false)) return
    focus(deleteButton.current)
  }, [mode])

  const play = async () => {
    const reply = await client.request({ type: 'openDownload', downloadId }).catch(() => null)
    if (reply === null) return showNotice(UNREACHED)
    openReply(reply)
  }

  const act = async () => {
    switch (action.name) {
      case 'Play':
        return play()
      case 'Pause':
        return change({ type: 'pauseDownload', downloadId })
      case 'Resume':
        // A library locked again needs its PIN before main can fetch from it.
        if (view.needsUnlock) return setIsUnlocking(true)
        return change({ type: 'resumeDownload', downloadId })
      case 'Retry':
        return change({ type: 'retryDownload', downloadId })
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
    const isDeleted = await change({ type: 'deleteDownload', downloadId })
    isDeletingNow.current = false
    setIsDeleting(false)
    setMode('view')
    if (isDeleted) onDeleted()
  }

  const backOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    setMode('view')
  }

  const from =
    view.serverName === '' ? view.group.title : `${view.group.title} · ${view.serverName}`

  return (
    <li ref={row} className={mode === 'view' ? styles.row : styles.asking}>
      {mode === 'delete' ? (
        <>
          <p id={ids.question} className={styles.question}>
            {`Delete ${label}? ${formatBytes(view.size)} will be freed.`}
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
            <Button ref={cancelButton} onClick={() => setMode('view')} onKeyDown={backOnEscape}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <span id={ids.label} className={styles.label}>
            {label}
          </span>
          <span className={styles.from}>{from}</span>
          <span className={styles.size}>{formatBytes(view.size)}</span>
          <p className={styles.status}>
            <StatusLine view={view} textId={ids.status} />
          </p>
          <div className={styles.actions}>
            <Button
              className={styles.act}
              tone={action.name === 'Play' ? 'primary' : 'quiet'}
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
                    type: 'setDownloadAutoDelete',
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
              onClick={() => setMode('delete')}
            >
              Delete
            </Button>
          </div>
        </>
      )}
      {isUnlocking && (
        <UnlockDialog
          secret="pin"
          hint={SERVER_COPY.pinHint(view.serverName)}
          unlock={(entered) => serverApiFor({ client, serverId: view.serverId }).unlock(entered)}
          onUnlocked={() => {
            setIsUnlocking(false)
            return change({ type: 'resumeDownload', downloadId })
          }}
          onClose={() => setIsUnlocking(false)}
        />
      )}
    </li>
  )
}
