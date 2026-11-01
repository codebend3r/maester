import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_KINDS,
  type DownloadAsk,
  type DownloadKind,
} from '@raven/core'
import { Button, UNLOCK_SECRETS, UnlockDialog } from '@raven/ui'
import { useQueryClient } from '@tanstack/react-query'
import { type ComponentType, type FormEvent, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DOWNLOAD_DIALOG_COPY } from '@/desktop/DownloadDialog/copy'
import { handled } from '@/desktop/handled'
import { useOpenReply } from '@/desktop/openReply'
import { useModal } from '@/lib/useModal'
import { api } from '@/lib/api'
import { signInPath } from '@/lib/authRoutes'
import { useComputerName, useDesktop } from '@/stores/desktop'
import { declineAsk } from '@/stores/downloadAsk'
import styles from '@/desktop/DesktopDialog.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type ReadyStatus = Extract<DownloadAsk['status'], { kind: typeof DOWNLOAD_ASK_KINDS.ready }>

type FilesForProps = { kind: DownloadKind; files: number }

const filesFor = ({ kind, files }: FilesForProps): string => {
  switch (kind) {
    case DOWNLOAD_KINDS.movie:
    case DOWNLOAD_KINDS.saga:
      return DOWNLOAD_DIALOG_COPY.movies(files)
    case DOWNLOAD_KINDS.episode:
    case DOWNLOAD_KINDS.season:
    case DOWNLOAD_KINDS.show:
      return COMMON_COPY.episodes(files)
    case DOWNLOAD_KINDS.album:
    case DOWNLOAD_KINDS.playlist:
      return COMMON_COPY.tracks(files)
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

/** Whether the title has files left to fetch, or every one is already downloaded. */
const CONTENTS = { files: 'files', empty: 'empty' } as const

type Contents = (typeof CONTENTS)[keyof typeof CONTENTS]

type QuestionViewProps = { status: ReadyStatus; questionId: string; computer: string }

type FilesQuestionProps = QuestionViewProps

const FilesQuestion = ({ status, questionId, computer }: FilesQuestionProps) => {
  const question = DOWNLOAD_DIALOG_COPY.question({
    title: status.title,
    files: filesFor({ kind: status.downloadKind, files: status.files }),
    bytes: status.bytes,
  })
  const room = status.canFit
    ? DOWNLOAD_DIALOG_COPY.room({ free: status.free, computer })
    : DOWNLOAD_DIALOG_COPY.short({ bytes: status.bytes, free: status.free })
  return (
    <>
      <p id={questionId}>{question}</p>
      <p className={styles.hint}>{room}</p>
    </>
  )
}

type EmptyQuestionProps = QuestionViewProps

const EmptyQuestion = ({ status, questionId }: EmptyQuestionProps) => (
  <p id={questionId}>{DOWNLOAD_DIALOG_COPY.alreadyDownloaded(status.title)}</p>
)

const QUESTIONS = {
  [CONTENTS.files]: FilesQuestion,
  [CONTENTS.empty]: EmptyQuestion,
} as const satisfies Record<Contents, ComponentType<QuestionViewProps>>

type ReadyDialogProps = {
  ask: DownloadAsk
  status: ReadyStatus
  onClose: () => void
}

/** Asks before the title's files are fetched; leaving it any way but Download declines. */
const ReadyDialog = ({ ask, status, onClose }: ReadyDialogProps) => {
  const { client } = useDesktop()
  const computer = useComputerName()
  const openReply = useOpenReply()
  const { dialog, close, keepKeys } = useModal()
  const isConfirmed = useRef(false)
  const ids = { title: useId(), question: useId() }
  const [shouldAutoDelete, setShouldAutoDelete] = useState(ask.shouldAutoDelete)
  const isEmpty = status.files === 0
  const canDownload = status.canFit && !isEmpty

  // Cancel, Escape and Download all end here; only Download has already answered.
  const closed = () => {
    if (!isConfirmed.current) declineAsk(ask)
    onClose()
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (!canDownload || isConfirmed.current) return
    isConfirmed.current = true
    close()
    openReply(
      await client.request({
        type: DESKTOP_REQUESTS.confirmDownload,
        askId: ask.askId,
        shouldAutoDelete: shouldAutoDelete,
      }),
    )
  }

  const Question = QUESTIONS[isEmpty ? CONTENTS.empty : CONTENTS.files]

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={ids.title}
      aria-describedby={ids.question}
      onClose={closed}
      onKeyDown={keepKeys}
    >
      <form className={styles.form} onSubmit={(event) => handled(confirm(event))}>
        <h2 id={ids.title} className={styles.title}>
          {DOWNLOAD_DIALOG_COPY.title}
        </h2>
        <Question status={status} questionId={ids.question} computer={computer} />
        {canDownload && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={shouldAutoDelete}
              onChange={(event) => setShouldAutoDelete(event.target.checked)}
            />
            {COMMON_COPY.deleteOnceWatched}
          </label>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>{COMMON_COPY.cancel}</Button>
          {canDownload && (
            <Button type="submit" tone="primary" icon="download">
              {COMMON_COPY.download}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  )
}

type LockedDialogProps = { ask: DownloadAsk; onClose: () => void }

/**
 * The title sits in a locked library: the page enters the PIN as anywhere else, which main's own
 * calls then carry, and main reads the title again.
 */
const LockedDialog = ({ ask, onClose }: LockedDialogProps) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  const queryClient = useQueryClient()

  const retry = async () => {
    const reply = await client.request({
      type: DESKTOP_REQUESTS.retryDownloadAsk,
      askId: ask.askId,
    })
    // The unlock dialog has closed itself, so nothing is left to show unless main asks again.
    if (reply.type !== DESKTOP_REPLIES.downloadAsk) onClose()
    openReply(reply)
    // The PIN opened the locked libraries for every page too.
    await queryClient.invalidateQueries()
  }

  return (
    <UnlockDialog
      secret={UNLOCK_SECRETS.pin}
      hint={DOWNLOAD_DIALOG_COPY.lockedHint}
      unlock={(entered) => api.unlock(entered)}
      onUnlocked={retry}
      onClose={() => {
        declineAsk(ask)
        onClose()
      }}
    />
  )
}

type AccountDialogProps = { ask: DownloadAsk; onClose: () => void }

/** The page is signed out, so main has no account to download with: the person signs in first. */
const AccountDialog = ({ ask, onClose }: AccountDialogProps) => {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const { dialog, close, keepKeys } = useModal()
  const titleId = useId()

  const closed = () => {
    declineAsk(ask)
    onClose()
  }

  const signIn = () => {
    close()
    handled(Promise.resolve(navigate(signInPath({ returnTo: `${pathname}${search}` }))))
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={closed}
      onKeyDown={keepKeys}
    >
      <div className={styles.form}>
        <h2 id={titleId} className={styles.title}>
          {DOWNLOAD_DIALOG_COPY.title}
        </h2>
        <p>{DOWNLOAD_DIALOG_COPY.signInFirst}</p>
        <div className={styles.actions}>
          <Button onClick={close}>{COMMON_COPY.cancel}</Button>
          <Button tone="primary" onClick={signIn}>
            {COMMON_COPY.signIn}
          </Button>
        </div>
      </div>
    </dialog>
  )
}

type DialogViewProps = { ask: DownloadAsk; onClose: () => void }

type ReadyViewProps = DialogViewProps

/** The ready dialog reads the files the status lists, which only a ready status holds. */
const ReadyView = ({ ask, onClose }: ReadyViewProps) =>
  ask.status.kind === DOWNLOAD_ASK_KINDS.ready && (
    <ReadyDialog ask={ask} status={ask.status} onClose={onClose} />
  )

const DIALOGS = {
  [DOWNLOAD_ASK_KINDS.ready]: ReadyView,
  [DOWNLOAD_ASK_KINDS.locked]: LockedDialog,
  [DOWNLOAD_ASK_KINDS.account]: AccountDialog,
} as const satisfies Record<DownloadAsk['status']['kind'], ComponentType<DialogViewProps>>

type DownloadDialogProps = { ask: DownloadAsk; onClose: () => void }

/** What Raven asks before it downloads a title, from a Download button or a link. */
export const DownloadDialog = ({ ask, onClose }: DownloadDialogProps) => {
  const Dialog = DIALOGS[ask.status.kind]
  return <Dialog ask={ask} onClose={onClose} />
}
