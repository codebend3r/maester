import { KEYS, formatBytes } from '@raven/core'
import { Button, UNLOCK_SECRETS, UnlockDialog, type UnlockSecret } from '@raven/ui'
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ACCOUNT_COPY } from '@/renderer/Account/accountCopy'
import { AccountRefused } from '@/renderer/Account/AccountRefused'
import { SignInForm } from '@/renderer/Account/SignInForm'
import { useAccount } from '@/renderer/desktop/accountApi'
import type { DesktopClient } from '@/renderer/desktop/client'
import { useDesktop } from '@/renderer/stores/desktop'
import { UNREACHED } from '@/renderer/desktop/downloadsApi'
import { serverApiFor } from '@/renderer/desktop/serverApi'
import styles from '@/renderer/Shell/DownloadDialog.module.scss'
import { useOpenReply } from '@/renderer/Shell/openReply'
import { SERVER_COPY } from '@/renderer/ServerPage/serverServices'
import { useNotice } from '@/renderer/stores/notice'
import {
  ACCOUNT_STATES,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_KINDS,
  type AccountView,
  type DesktopReply,
  type DesktopRequest,
  type DownloadAsk,
  type DownloadKind,
} from '@/shared/protocol'

type ReadyStatus = Extract<DownloadAsk['status'], { kind: typeof DOWNLOAD_ASK_KINDS.ready }>

const TITLE = 'Download to raven player'

/** Main's answer, or null when the request itself failed. */
const askMain = ({
  client,
  request,
}: {
  client: DesktopClient
  request: DesktopRequest
}): Promise<DesktopReply | null> => client.request(request).catch(() => null)

const nounFor = ({ kind, files }: { kind: DownloadKind; files: number }): string => {
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
  const showNotice = useNotice((state) => state.show)
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

  // Cancel, Escape and Download all end here; only Download has already answered.
  const closed = () => {
    if (!isConfirmed.current) {
      void askMain({
        client,
        request: { type: DESKTOP_REQUESTS.declineDownload, askId: ask.askId },
      })
    }
    onClose()
  }

  // The player listens on the window: a key pressed here stays here. Escape closes the dialog itself.
  const keepKeys = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== KEYS.escape) return
    event.preventDefault()
    close()
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (!canDownload || isConfirmed.current) return
    isConfirmed.current = true
    close()
    const reply = await askMain({
      client,
      request: { type: DESKTOP_REQUESTS.confirmDownload, askId: ask.askId, autoDelete },
    })
    if (reply === null) return showNotice(UNREACHED)
    openReply(reply)
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
  secret: UnlockSecret
  onClose: () => void
}) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  const showNotice = useNotice((state) => state.show)
  const api = useMemo(
    () => serverApiFor({ client, serverId: ask.serverId }),
    [client, ask.serverId],
  )

  const retry = async () => {
    const reply = await askMain({
      client,
      request: { type: DESKTOP_REQUESTS.retryDownloadAsk, askId: ask.askId },
    })
    // The unlock dialog has closed itself, so nothing is left to show unless the Shell gets a new ask.
    if (reply === null || reply.type !== DESKTOP_REPLIES.downloadAsk) onClose()
    if (reply === null) return showNotice(UNREACHED)
    openReply(reply)
  }

  return (
    <UnlockDialog
      secret={secret}
      hint={
        secret === UNLOCK_SECRETS.pin
          ? SERVER_COPY.pinHint(ask.serverName)
          : SERVER_COPY.adminHint(ask.serverName)
      }
      unlock={(entered) =>
        secret === UNLOCK_SECRETS.pin ? api.unlock(entered) : api.unlockAdmin(entered)
      }
      onUnlocked={retry}
      onClose={() => {
        void askMain({
          client,
          request: { type: DESKTOP_REQUESTS.declineDownload, askId: ask.askId },
        })
        onClose()
      }}
    />
  )
}

/** What the dialog says of an account that does not let the download through, and is no form to fill. */
const AccountNote = ({ account, serverName }: { account: AccountView; serverName: string }) => {
  switch (account.state) {
    case ACCOUNT_STATES.signedOut:
      return null
    case ACCOUNT_STATES.pending:
    case ACCOUNT_STATES.revoked:
      return (
        <AccountRefused serverId={account.serverId} state={account.state} email={account.email} />
      )
    case ACCOUNT_STATES.approved:
    case ACCOUNT_STATES.off:
      return <p>{`Asking ${serverName} again.`}</p>
    case ACCOUNT_STATES.unavailable:
      return <p>{ACCOUNT_COPY.unavailable(serverName)}</p>
    case ACCOUNT_STATES.failed:
      return <p>{ACCOUNT_COPY.failed(serverName)}</p>
    default: {
      const unreachable: never = account.state
      return unreachable
    }
  }
}

/**
 * A download link from a server whose accounts are ready, while the account is not let in: the
 * person signs in, or checks again, and main reads the link again once the account is approved.
 */
const AccountDialog = ({
  ask,
  account: asked,
  onClose,
}: {
  ask: DownloadAsk
  account: AccountView
  onClose: () => void
}) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  const showNotice = useNotice((state) => state.show)
  const dialog = useRef<HTMLDialogElement>(null)
  const isRetrying = useRef(false)
  const titleId = useId()
  const [openedAt] = useState(() => Date.now())
  const read = useAccount(ask.serverId)
  // Main's answer with the ask stands until the account is read again while the dialog is open: an
  // older read kept from Settings could let a download through that main has not.
  const account = read.data !== undefined && read.dataUpdatedAt >= openedAt ? read.data : asked
  const isLetIn = account.state === ACCOUNT_STATES.approved || account.state === ACCOUNT_STATES.off

  useEffect(() => {
    if (dialog.current !== null && !dialog.current.open) dialog.current.showModal()
  }, [])

  const close = () => {
    if (dialog.current !== null) dialog.current.close()
  }

  // Cancel and Escape end here; a retry has already answered for the ask.
  const closed = () => {
    if (!isRetrying.current) {
      void askMain({
        client,
        request: { type: DESKTOP_REQUESTS.declineDownload, askId: ask.askId },
      })
    }
    onClose()
  }

  const keepKeys = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== KEYS.escape) return
    event.preventDefault()
    close()
  }

  const retry = async () => {
    if (isRetrying.current) return
    isRetrying.current = true
    const reply = await askMain({
      client,
      request: { type: DESKTOP_REQUESTS.retryDownloadAsk, askId: ask.askId },
    })
    // A new ask opens a dialog of its own; anything else leaves nothing to show here.
    if (reply === null || reply.type !== DESKTOP_REPLIES.downloadAsk) close()
    if (reply === null) return showNotice(UNREACHED)
    openReply(reply)
  }

  const retryOnce = useEffectEvent(() => void retry())

  useEffect(() => {
    if (isLetIn) retryOnce()
  }, [isLetIn])

  const isSignedOut = account.state === ACCOUNT_STATES.signedOut

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={closed}
      onKeyDown={keepKeys}
    >
      <section className={styles.content}>
        <h2 id={titleId} className={styles.title}>
          {TITLE}
        </h2>
        {isSignedOut ? (
          <>
            <p>{`Sign in to ${ask.serverName} to download from it.`}</p>
            <SignInForm
              serverId={ask.serverId}
              signInHost={account.signInHost}
              isRemembered={account.isRemembered}
              onCancel={close}
            />
          </>
        ) : (
          <>
            <AccountNote account={account} serverName={ask.serverName} />
            <div className={styles.actions}>
              <Button onClick={close}>Cancel</Button>
            </div>
          </>
        )}
      </section>
    </dialog>
  )
}

export const DownloadDialog = ({ ask, onClose }: { ask: DownloadAsk; onClose: () => void }) => {
  const { status } = ask
  switch (status.kind) {
    case DOWNLOAD_ASK_KINDS.ready:
      return <ReadyDialog ask={ask} status={status} onClose={onClose} />
    case DOWNLOAD_ASK_KINDS.locked:
      return <LockedDialog ask={ask} secret={UNLOCK_SECRETS.pin} onClose={onClose} />
    case DOWNLOAD_ASK_KINDS.hidden:
      return <LockedDialog ask={ask} secret={UNLOCK_SECRETS.adminPassword} onClose={onClose} />
    case DOWNLOAD_ASK_KINDS.account:
      return <AccountDialog ask={ask} account={status.account} onClose={onClose} />
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}
