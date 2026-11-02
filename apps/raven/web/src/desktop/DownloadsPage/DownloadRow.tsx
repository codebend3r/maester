import {
  DESKTOP_REQUESTS,
  DOWNLOAD_ARTWORK_KINDS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadStatus,
  type DownloadView,
  formatBytes,
  isMusicGroup,
  KEYS,
} from '@raven/core'
import { Button, type IconName } from '@raven/ui'
import {
  type ComponentType,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { handled } from '@/desktop/handled'
import { useChangeDownloads } from '@/desktop/downloadsApi'
import { DOWNLOAD_ROW_COPY } from '@/desktop/DownloadsPage/copy'
import { DownloadActivity } from '@/desktop/DownloadsPage/DownloadActivity'
import { DownloadArtwork } from '@/desktop/DownloadsPage/DownloadArtwork'
import { usePlayDownload } from '@/desktop/DownloadsPage/usePlayDownload'
import { useDownloadSpeed } from '@/desktop/useDownloadSpeed'
import { POSTER_SIZES } from '@/lib/posters'
import { watchedLabel } from '@/desktop/watched'
import styles from '@/desktop/DownloadsPage/DownloadsPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** What a row shows: the download, or the question before it is deleted. */
const ROW_MODES = { view: 'view', delete: 'delete' } as const

type RowMode = (typeof ROW_MODES)[keyof typeof ROW_MODES]

/** The one action a row's status allows beside Delete. */
const ROW_ACTIONS = { play: 'play', pause: 'pause', resume: 'resume', retry: 'retry' } as const

type RowAction = (typeof ROW_ACTIONS)[keyof typeof ROW_ACTIONS]

/** Each action's button: its words and its icon. */
const ACTION_BUTTONS = {
  play: { label: COMMON_COPY.play, icon: 'play' },
  pause: { label: COMMON_COPY.pause, icon: 'pause' },
  resume: { label: DOWNLOAD_ROW_COPY.resume, icon: 'download' },
  retry: { label: DOWNLOAD_ROW_COPY.retry, icon: 'rescan' },
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

type DeletesInProps = { at: number }

/** How long until a download set to delete once watched goes, in whole minutes rounded up. */
const DeletesIn = ({ at }: DeletesInProps) => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), DELETES_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const minutes = Math.ceil((at - now) / MINUTE_MS)
  return minutes > 0 && <span>{DOWNLOAD_ROW_COPY.deletesIn(minutes)}</span>
}

type StatusLineProps = { view: DownloadView; textId: string }

type DownloadingLineProps = StatusLineProps

const DownloadingLine = ({ view, textId }: DownloadingLineProps) => {
  const speed = useDownloadSpeed(view.downloadId)
  return (
    view.status.kind === DOWNLOAD_STATUS_KINDS.downloading && (
      <>
        <span id={textId} className={styles.progressText}>
          <span>
            {DOWNLOAD_ROW_COPY.downloadedOf({ bytes: view.status.bytes, size: view.size })}
          </span>
          <span className={styles.speed}>
            {speed === null ? DOWNLOAD_ROW_COPY.starting : DOWNLOAD_ROW_COPY.speed(speed)}
          </span>
        </span>
        <DownloadActivity value={view.status.bytes} max={view.size} labelledBy={textId} />
      </>
    )
  )
}

const QueuedLine = () => <span>{DOWNLOAD_ROW_COPY.waiting}</span>

type PausedLineProps = StatusLineProps

const PausedLine = ({ view }: PausedLineProps) =>
  view.status.kind === DOWNLOAD_STATUS_KINDS.paused && (
    <span>{view.status.message ?? DOWNLOAD_ROW_COPY.paused}</span>
  )

type FailedLineProps = StatusLineProps

const FailedLine = ({ view }: FailedLineProps) =>
  view.status.kind === DOWNLOAD_STATUS_KINDS.failed && (
    <span>{DOWNLOAD_ROW_COPY.failed(view.status.message)}</span>
  )

/**
 * How a row lays out by what it holds: a video is watched and may delete itself once it is, so
 * it shows its share watched and the switch; a track neither, so its actions leave the switch's
 * place out.
 */
const ROW_KINDS = {
  video: { isWatchable: true, actions: styles.actions },
  music: { isWatchable: false, actions: `${styles.actions} ${styles.musicActions}` },
} as const satisfies Record<string, { isWatchable: boolean; actions: string | undefined }>

type RowKindOfProps = DownloadView

const rowKindOf = ({ group }: RowKindOfProps) =>
  isMusicGroup(group) ? ROW_KINDS.music : ROW_KINDS.video

/** What Play does on a ready row: opens a video in the player, or queues a track with its group. */
export const ROW_PLAYS = { player: 'player', queue: 'queue', none: 'none' } as const

/**
 * `none` is a ready track of a server Raven no longer holds, which the music engine has nothing
 * to queue it by, so its row shows no Play.
 */
export type RowPlay =
  | { kind: typeof ROW_PLAYS.player }
  | { kind: typeof ROW_PLAYS.queue; play: () => void }
  | { kind: typeof ROW_PLAYS.none }

type ReadyLineProps = StatusLineProps

const ReadyLine = ({ view }: ReadyLineProps) =>
  rowKindOf(view).isWatchable && (
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

/** Where a download stands: its progress, its wait, why it stopped, or how much of it was watched. */
const STATUS_LINES = {
  [DOWNLOAD_STATUS_KINDS.downloading]: DownloadingLine,
  [DOWNLOAD_STATUS_KINDS.queued]: QueuedLine,
  [DOWNLOAD_STATUS_KINDS.paused]: PausedLine,
  [DOWNLOAD_STATUS_KINDS.failed]: FailedLine,
  [DOWNLOAD_STATUS_KINDS.ready]: ReadyLine,
} as const satisfies Record<DownloadStatus['kind'], ComponentType<StatusLineProps>>

/** Where a download stands, by its status. */
const StatusLine = ({ view, textId }: StatusLineProps) => {
  const Line = STATUS_LINES[view.status.kind]
  return <Line view={view} textId={textId} />
}

type ButtonRef = RefObject<HTMLButtonElement | null>

type RowViewProps = {
  view: DownloadView
  ids: { label: string; status: string; question: string }
  action: RowAction
  /** Whether the row shows its action: a ready track of a server Raven no longer holds has none. */
  hasAction: boolean
  isDeleting: boolean
  deleteButton: ButtonRef
  cancelButton: ButtonRef
  onAct: () => void
  onRemove: () => void
  onAsk: () => void
  onBack: () => void
  onBackKey: (event: KeyboardEvent) => void
  onAutoDelete: (shouldAutoDelete: boolean) => void
}

type AskingRowProps = RowViewProps

/** The question before the download is deleted. */
const AskingRow = ({
  view,
  ids,
  isDeleting,
  cancelButton,
  onRemove,
  onBack,
  onBackKey,
}: AskingRowProps) => (
  <div className={styles.asking}>
    <p id={ids.question} className={styles.question}>
      {DOWNLOAD_ROW_COPY.deleteQuestion({ label: view.label, bytes: bytesOnDisk(view) })}
    </p>
    <div className={styles.confirm}>
      {/* aria-disabled, not disabled: disabling the focused button would drop focus to the page. */}
      <Button
        tone="danger"
        aria-describedby={ids.question}
        aria-disabled={isDeleting}
        onClick={onRemove}
        onKeyDown={onBackKey}
      >
        {COMMON_COPY.delete}
      </Button>
      <Button ref={cancelButton} onClick={onBack} onKeyDown={onBackKey}>
        {COMMON_COPY.cancel}
      </Button>
    </div>
  </div>
)

type ViewingRowProps = RowViewProps

/** The download: what it is, where it stands, and what can be done with it. */
const ViewingRow = ({
  view,
  ids,
  action,
  hasAction,
  deleteButton,
  onAct,
  onAsk,
  onAutoDelete,
}: ViewingRowProps) => {
  const { label } = view
  const actionButton = ACTION_BUTTONS[action]
  const kind = rowKindOf(view)
  return (
    <div className={styles.row}>
      <span
        className={
          view.artwork.kind === DOWNLOAD_ARTWORK_KINDS.cover
            ? `${styles.art} ${styles.square}`
            : styles.art
        }
        aria-hidden="true"
      >
        <DownloadArtwork
          artwork={view.artwork}
          initial={view.group.title.slice(0, 1)}
          sizes={POSTER_SIZES.bar}
        />
      </span>
      <span id={ids.label} className={styles.label}>
        {label}
      </span>
      <span className={styles.size}>{formatBytes(view.size)}</span>
      <p className={styles.status}>
        <StatusLine view={view} textId={ids.status} />
      </p>
      <div className={kind.actions}>
        {hasAction && (
          <Button
            className={styles.act}
            tone={action === ROW_ACTIONS.play ? 'primary' : 'quiet'}
            icon={actionButton.icon}
            aria-label={DOWNLOAD_ROW_COPY.actionLabel({ action: actionButton.label, label })}
            onClick={onAct}
          >
            {actionButton.label}
          </Button>
        )}
        {kind.isWatchable && (
          <label className={styles.auto}>
            <input
              type="checkbox"
              role="switch"
              checked={view.shouldAutoDelete}
              aria-checked={view.shouldAutoDelete}
              aria-describedby={ids.label}
              onChange={(event) => onAutoDelete(event.target.checked)}
            />
            {COMMON_COPY.deleteOnceWatched}
          </label>
        )}
        <Button
          ref={deleteButton}
          className={styles.remove}
          tone="ghost"
          icon="trash"
          aria-label={DOWNLOAD_ROW_COPY.deleteLabel(label)}
          onClick={onAsk}
        />
      </div>
    </div>
  )
}

const ROW_VIEWS = {
  [ROW_MODES.view]: ViewingRow,
  [ROW_MODES.delete]: AskingRow,
} as const satisfies Record<RowMode, ComponentType<RowViewProps>>

type DownloadRowProps = {
  view: DownloadView
  /** What Play does once the row is ready. */
  play: RowPlay
  /** The row is gone with its buttons, so the page takes the focus. */
  onDeleted: () => void
}

/** One downloaded file: what it is, where it stands, and what can be done with it. */
export const DownloadRow = ({ view, play, onDeleted }: DownloadRowProps) => {
  const change = useChangeDownloads()
  const playDownload = usePlayDownload()
  const [mode, setMode] = useState<RowMode>(ROW_MODES.view)
  const [isDeleting, setIsDeleting] = useState(false)
  const isDeletingNow = useRef(false)
  const row = useRef<HTMLLIElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const previousMode = useRef<RowMode>(mode)
  const ids = { label: useId(), status: useId(), question: useId() }
  const { downloadId } = view
  const action = actionOf(view.status)
  const hasAction = action !== ROW_ACTIONS.play || play.kind !== ROW_PLAYS.none
  const RowView = ROW_VIEWS[mode]

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

  // A track plays in the music engine, which finds its file, so it needs no grant and no server.
  const playRow = async (): Promise<unknown> => {
    switch (play.kind) {
      case ROW_PLAYS.player:
        return playDownload(downloadId)
      case ROW_PLAYS.queue:
        return play.play()
      case ROW_PLAYS.none:
        return undefined
      default: {
        const unreachable: never = play
        return unreachable
      }
    }
  }

  const act = async (): Promise<unknown> => {
    switch (action) {
      case ROW_ACTIONS.play:
        return playRow()
      case ROW_ACTIONS.pause:
        return change({ type: DESKTOP_REQUESTS.pauseDownload, downloadId })
      case ROW_ACTIONS.resume:
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
      <RowView
        view={view}
        ids={ids}
        action={action}
        hasAction={hasAction}
        isDeleting={isDeleting}
        deleteButton={deleteButton}
        cancelButton={cancelButton}
        onAct={() => handled(act())}
        onRemove={() => handled(remove())}
        onAsk={() => setMode(ROW_MODES.delete)}
        onBack={() => setMode(ROW_MODES.view)}
        onBackKey={backOnEscape}
        onAutoDelete={(shouldAutoDelete) =>
          handled(
            change({
              type: DESKTOP_REQUESTS.setDownloadAutoDelete,
              downloadId,
              shouldAutoDelete,
            }),
          )
        }
      />
    </li>
  )
}
