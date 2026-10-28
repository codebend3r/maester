import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_KINDS,
  type DownloadAsk,
  type DownloadKind,
  formatBytes,
} from '@raven/core'
import { Button, UNLOCK_SECRETS, UnlockDialog } from '@raven/ui'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { handled } from '@/desktop/handled'
import { useOpenReply } from '@/desktop/openReply'
import { useModal } from '@/lib/useModal'
import { api } from '@/lib/api'
import { signInPath } from '@/lib/authRoutes'
import { useComputerName, useDesktop } from '@/stores/desktop'
import { declineAsk } from '@/stores/downloadAsk'
import styles from '@/desktop/DesktopDialog.module.scss'

type ReadyStatus = Extract<DownloadAsk['status'], { kind: typeof DOWNLOAD_ASK_KINDS.ready }>

const TITLE = 'Download to Raven'

type NounForProps = { kind: DownloadKind; files: number }

const nounFor = ({ kind, files }: NounForProps): string => {
  switch (kind) {
    case DOWNLOAD_KINDS.movie:
    case DOWNLOAD_KINDS.saga:
      return files === 1 ? 'movie' : 'movies'
    case DOWNLOAD_KINDS.episode:
    case DOWNLOAD_KINDS.season:
    case DOWNLOAD_KINDS.show:
      return files === 1 ? 'episode' : 'episodes'
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

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

  const noun = nounFor({ kind: status.downloadKind, files: status.files })
  const question = `Download ${status.title} (${status.files} ${noun}, ${formatBytes(status.bytes)})?`
  const room = status.canFit
    ? `${formatBytes(status.free)} free on this ${computer}.`
    : `Needs ${formatBytes(status.bytes)}; ${formatBytes(status.free)} free.`

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
          {TITLE}
        </h2>
        {isEmpty ? (
          <p id={ids.question}>{`${status.title} is already downloaded.`}</p>
        ) : (
          <>
            <p id={ids.question}>{question}</p>
            <p className={styles.hint}>{room}</p>
          </>
        )}
        {canDownload && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={shouldAutoDelete}
              onChange={(event) => setShouldAutoDelete(event.target.checked)}
            />
            Delete once watched
          </label>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>Cancel</Button>
          {canDownload && (
            <Button type="submit" tone="primary" icon="download">
              Download
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
      hint="This title is in a locked library. Enter the PIN to download it."
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
          {TITLE}
        </h2>
        <p>Sign in to raven to download from it, then download again.</p>
        <div className={styles.actions}>
          <Button onClick={close}>Cancel</Button>
          <Button tone="primary" onClick={signIn}>
            Sign in
          </Button>
        </div>
      </div>
    </dialog>
  )
}

type DownloadDialogProps = { ask: DownloadAsk; onClose: () => void }

/** What Raven asks before it downloads a title, from a Download button or a link. */
export const DownloadDialog = ({ ask, onClose }: DownloadDialogProps) => {
  const { status } = ask
  switch (status.kind) {
    case DOWNLOAD_ASK_KINDS.ready:
      return <ReadyDialog ask={ask} status={status} onClose={onClose} />
    case DOWNLOAD_ASK_KINDS.locked:
      return <LockedDialog ask={ask} onClose={onClose} />
    case DOWNLOAD_ASK_KINDS.account:
      return <AccountDialog ask={ask} onClose={onClose} />
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}
