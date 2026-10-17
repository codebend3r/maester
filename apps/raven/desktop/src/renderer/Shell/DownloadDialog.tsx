import { formatBytes } from '@raven/core'
import { Button, UnlockDialog } from '@raven/ui'
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { serverApiFor } from '@/renderer/desktop/serverApi'
import styles from '@/renderer/Shell/DownloadDialog.module.scss'
import { useOpenReply } from '@/renderer/Shell/openReply'
import { SERVER_COPY } from '@/renderer/ServerPage/serverServices'
import { useDesktop } from '@/renderer/stores/desktop'
import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DownloadAsk,
  type DownloadKind,
} from '@/shared/protocol'

type ReadyStatus = Extract<DownloadAsk['status'], { kind: 'ready' }>

const TITLE = 'Download to raven player'

const nounFor = ({ kind, files }: { kind: DownloadKind; files: number }): string => {
  switch (kind) {
    case 'movie':
    case 'saga':
      return files === 1 ? 'movie' : 'movies'
    case 'episode':
    case 'season':
    case 'show':
      return files === 1 ? 'episode' : 'episodes'
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

/** Asks before a download link's files are fetched; leaving it any way but Download declines. */
const ReadyDialog = ({
  ask,
  status,
  onClose,
}: {
  ask: DownloadAsk
  status: ReadyStatus
  onClose: () => void
}) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  const dialog = useRef<HTMLDialogElement>(null)
  const isConfirmed = useRef(false)
  const ids = { title: useId(), question: useId() }
  const [autoDelete, setAutoDelete] = useState(ask.autoDelete)
  const isEmpty = status.files === 0
  const canDownload = status.fits && !isEmpty

  useEffect(() => {
    if (dialog.current !== null && !dialog.current.open) dialog.current.showModal()
  }, [])

  const close = () => {
    if (dialog.current !== null) dialog.current.close()
  }

  // Cancel, Escape and a click away all end here; only Download has already answered.
  const closed = () => {
    if (!isConfirmed.current)
      void client.request({ type: DESKTOP_REQUESTS.declineDownload, askId: ask.askId })
    onClose()
  }

  // The player listens on the window: a key pressed here stays here. Escape closes the dialog itself.
  const keepKeys = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
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
        autoDelete,
      }),
    )
  }

  const question = `Download ${status.title} (${status.files} ${nounFor({ kind: status.downloadKind, files: status.files })}, ${formatBytes(status.bytes)}) from ${ask.serverName}?`
  const room = status.fits
    ? `${formatBytes(status.free)} free on this disk.`
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
      <form className={styles.form} onSubmit={(event) => void confirm(event)}>
        <h2 id={ids.title} className={styles.title}>
          {TITLE}
        </h2>
        {isEmpty ? (
          <p id={ids.question}>{`${status.title} is already downloaded.`}</p>
        ) : (
          <>
            <p id={ids.question}>{question}</p>
            <p className={styles.room}>{room}</p>
          </>
        )}
        {canDownload && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={autoDelete}
              onChange={(event) => setAutoDelete(event.target.checked)}
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

/** A download link's lock: the secret is asked for, and main reads the link again once it is lifted. */
const LockedDialog = ({
  ask,
  secret,
  onClose,
}: {
  ask: DownloadAsk
  secret: 'pin' | 'adminPassword'
  onClose: () => void
}) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  const api = useMemo(
    () => serverApiFor({ client, serverId: ask.serverId }),
    [client, ask.serverId],
  )

  const retry = async () => {
    const reply = await client.request({
      type: DESKTOP_REQUESTS.retryDownloadAsk,
      askId: ask.askId,
    })
    // A new ask replaces this one in the Shell; anything else is a notice, and this dialog is done.
    if (reply.type !== DESKTOP_REPLIES.downloadAsk) onClose()
    openReply(reply)
  }

  return (
    <UnlockDialog
      secret={secret}
      hint={
        secret === 'pin'
          ? SERVER_COPY.pinHint(ask.serverName)
          : SERVER_COPY.adminHint(ask.serverName)
      }
      unlock={(entered) => (secret === 'pin' ? api.unlock(entered) : api.unlockAdmin(entered))}
      onUnlocked={retry}
      onClose={() => {
        void client.request({ type: DESKTOP_REQUESTS.declineDownload, askId: ask.askId })
        onClose()
      }}
    />
  )
}

export const DownloadDialog = ({ ask, onClose }: { ask: DownloadAsk; onClose: () => void }) => {
  const { status } = ask
  switch (status.kind) {
    case 'ready':
      return <ReadyDialog ask={ask} status={status} onClose={onClose} />
    case 'locked':
      return <LockedDialog ask={ask} secret="pin" onClose={onClose} />
    case 'hidden':
      return <LockedDialog ask={ask} secret="adminPassword" onClose={onClose} />
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}
