import {
  type ApiClient,
  ApiError,
  isLockedError,
  isMediaId,
  type MediaItem,
  mediaLabel,
  type PlayerSource,
} from '@raven/core'
import {
  Button,
  type NativePlayer,
  type PlayerServices,
  UnlockDialog,
  type UnlockSecret,
} from '@raven/ui'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { CONNECTION_STATUSES } from '@/renderer/desktop/playerConnection'
import { serverApiFor, useServers } from '@/renderer/desktop/serverApi'
import { NativePlaying } from '@/renderer/PlayPage/NativePlaying'
import { Refused, useIsOutputFixed, Waiting } from '@/renderer/PlayPage/PlayPage'
import { requestQuietly } from '@/renderer/PlayPage/playerServices'
import { useChosenEngine } from '@/renderer/PlayPage/useChosenEngine'
import styles from '@/renderer/ServerPage/ServerPage.module.scss'
import {
  browserRefusalOf,
  isServerPlayState,
  openInBrowser,
  resumeAtFor,
  SERVER_COPY,
  type ServerPlayState,
  serverServicesFor,
  shareOf,
} from '@/renderer/ServerPage/serverServices'
import { useDesktop } from '@/renderer/stores/desktop'
import {
  isOpaqueId,
  MENU_PLAYER_ACTIONS,
  type MenuPlayerAction,
  SERVER_GONE,
  type ServerView,
} from '@/shared/protocol'

const NOT_OPENABLE = 'raven player cannot open that title.'

/** The route's media id: digits only, as main's allowlist reads it, then a whole number. */
const MEDIA_ID = /^[1-9]\d{0,15}$/

const NO_STATE: ServerPlayState = { at: 0, next: [] }

const mediaIdOf = ({ param }: { param: string | undefined }): number | null => {
  if (param === undefined || !MEDIA_ID.test(param)) return null
  const id = Number(param)
  return isMediaId(id) ? id : null
}

type Title = { server: ServerView; mediaId: number; at: number; next: number[] }

/** Opens the title in the browser through main, keeping main's reason when it will not. */
const useOpenInBrowser = ({ serverId, mediaId }: { serverId: string; mediaId: number }) => {
  const { client } = useDesktop()
  const [refusal, setRefusal] = useState<string | null>(null)
  const open = useCallback(() => {
    openInBrowser({ client, serverId, mediaId }).then(
      (answer) => setRefusal(browserRefusalOf(answer)),
      (error: unknown) => {
        console.warn('raven player could not send openInBrowser.', error)
      },
    )
  }, [client, serverId, mediaId])
  return { open, refusal }
}

const BrowserRefusal = ({ refusal }: { refusal: string | null }) =>
  refusal !== null && <p role="alert">{refusal}</p>

/**
 * Without the video engine the page cannot play a server title, having no network of its
 * own, so the title opens in the browser. A ref, so StrictMode's second effect sends none.
 */
const BrowserFallback = ({
  server,
  mediaId,
  isLost,
}: Omit<Title, 'at' | 'next'> & { isLost: boolean }) => {
  const browser = useOpenInBrowser({ serverId: server.serverId, mediaId })
  const { open } = browser
  const hasOpened = useRef(false)

  useEffect(() => {
    // After a loss the viewer chooses: the copy offers the browser rather than leaving for it.
    if (isLost || hasOpened.current) return
    hasOpened.current = true
    open()
  }, [isLost, open])

  return (
    <Refused
      title={isLost ? 'The video engine stopped' : 'Opened in your browser'}
      message={isLost ? SERVER_COPY.engineStopped : SERVER_COPY.inBrowser(server.name)}
    >
      <div className={styles.actions}>
        <Button icon="globe" onClick={browser.open}>
          Open in browser
        </Button>
      </div>
      <BrowserRefusal refusal={browser.refusal} />
    </Refused>
  )
}

/** The server said no, or could not be asked: say why, and offer another go or the browser. */
const CannotRead = ({
  server,
  mediaId,
  message,
  onRetry,
}: {
  server: ServerView
  mediaId: number
  message: string
  onRetry: () => void
}) => {
  const browser = useOpenInBrowser({ serverId: server.serverId, mediaId })
  // Main opens the browser only for a server it keeps.
  const canOpen = message !== SERVER_GONE
  return (
    <Refused message={message}>
      <div className={styles.actions}>
        <Button tone="primary" onClick={onRetry}>
          Try again
        </Button>
        {canOpen && (
          <Button icon="globe" onClick={browser.open}>
            Open in browser
          </Button>
        )}
      </div>
      <BrowserRefusal refusal={browser.refusal} />
    </Refused>
  )
}

/** A locked title: the server's secret is asked for over a quiet page, and Cancel goes Home. */
const Locked = ({
  secret,
  hint,
  unlock,
  onUnlocked,
}: {
  secret: UnlockSecret
  hint: string
  unlock: (entered: string) => Promise<unknown>
  onUnlocked: () => Promise<unknown>
}) => {
  const navigate = useNavigate()
  return (
    <main className={styles.locked} aria-label="Locked title">
      <UnlockDialog
        secret={secret}
        hint={hint}
        unlock={unlock}
        onUnlocked={onUnlocked}
        onClose={() => void navigate('/')}
      />
    </main>
  )
}

/** The title on the native engine, with its next title's label once the server gives it. */
const Ready = ({
  media,
  server,
  api,
  player,
  at,
  next,
  lastSaved,
  length,
  hasRecordedPlay,
  onEngineError,
  onLost,
}: {
  media: MediaItem
  server: ServerView
  api: ApiClient
  player: NativePlayer
  at: number
  next: number[]
  lastSaved: { current: number }
  length: { current: number | null }
  hasRecordedPlay: { current: boolean }
  onEngineError: NonNullable<PlayerServices['onEngineError']>
  onLost: () => void
}) => {
  const { client, menu } = useDesktop()
  const navigate = useNavigate()
  const isOutputFixed = useIsOutputFixed()
  const { serverId } = server
  const browser = useOpenInBrowser({ serverId, mediaId: media.id })
  const [isServerGone, setIsServerGone] = useState(false)
  const noteRefusal = useCallback((message: string) => {
    if (message === SERVER_GONE) setIsServerGone(true)
  }, [])
  const noteEngineError = useCallback<NonNullable<PlayerServices['onEngineError']>>(
    (error) => {
      noteRefusal(error.message)
      onEngineError(error)
    },
    [noteRefusal, onEngineError],
  )
  const escape = useMemo(
    () => (isServerGone ? null : { run: browser.open, feedback: browser.refusal }),
    [isServerGone, browser.open, browser.refusal],
  )
  const [nextId] = next
  const nextMedia = useQuery({
    queryKey: ['desktop', 'server', serverId, 'next', nextId],
    queryFn: nextId === undefined ? skipToken : () => api.getMedia(nextId),
    retry: false,
  })
  const nextLabel = nextMedia.data === undefined ? null : mediaLabel(nextMedia.data)
  const base = useMemo(
    () =>
      serverServicesFor({
        media,
        server,
        api,
        client,
        menu,
        at,
        next:
          nextId === undefined || nextLabel === null
            ? null
            : { mediaId: nextId, label: nextLabel, rest: next.slice(1) },
        lastSaved,
        length,
        hasRecordedPlay,
        escape,
        onEngineError: noteEngineError,
      }),
    [
      media,
      server,
      api,
      client,
      menu,
      at,
      next,
      nextId,
      nextLabel,
      lastSaved,
      length,
      hasRecordedPlay,
      escape,
      noteEngineError,
    ],
  )
  const services = useMemo(() => ({ ...base, isVolumeFixed: isOutputFixed }), [base, isOutputFixed])
  const { resumeAt } = services.title
  const source = useMemo<PlayerSource>(
    () => ({ kind: 'server', serverId, mediaId: media.id }),
    [serverId, media.id],
  )

  const onMenu = useEffectEvent((action: MenuPlayerAction) => {
    if (action !== 'next' || services.title.next === null) return
    const { to, state } = services.title.next
    void navigate(to, { replace: true, state })
  })

  useEffect(() => menu.subscribe(onMenu), [menu])

  return (
    <NativePlaying
      services={services}
      player={player}
      source={source}
      resumeAt={resumeAt}
      onLost={onLost}
      onRefused={noteRefusal}
    />
  )
}

/**
 * Reads the title from its server, asking for the admin password or the PIN when the server
 * hides or locks it, then plays it. A library locking mid-play asks again and resumes at
 * the last position the server saved.
 */
const NativeTitle = ({
  server,
  mediaId,
  at,
  next,
  player,
  onLost,
}: Title & { player: NativePlayer; onLost: () => void }) => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const { serverId } = server
  const api = useMemo(() => serverApiFor({ client, serverId }), [client, serverId])
  const mediaKey = useMemo(
    () => ['desktop', 'server', serverId, 'media', mediaId],
    [serverId, mediaId],
  )
  const adminKey = useMemo(() => ['desktop', 'server', serverId, 'adminLock'], [serverId])
  const media = useQuery({
    queryKey: mediaKey,
    queryFn: () => api.getMedia(mediaId),
    retry: false,
    // Reading the title again while it plays would move its resume point under the player.
    staleTime: Infinity,
    gcTime: 0,
  })
  const isHidden = media.error instanceof ApiError && media.error.status === 404
  // Only a missing title asks: while the admin lock is on, a locked library's titles are hidden.
  const adminLock = useQuery({
    queryKey: adminKey,
    queryFn: () => api.getAdminLock(),
    enabled: isHidden,
    retry: false,
    gcTime: 0,
  })
  const lastSaved = useRef(0)
  // The page's, so a services rebuild or a relock remount keeps what the engine learned.
  const length = useRef<number | null>(null)
  const hasRecordedPlay = useRef(false)
  const [resumeFrom, setResumeFrom] = useState<number | null>(null)
  const hasNoted = useRef(false)

  // The admin lock is read again only when a title is missing again.
  const reread = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKey, refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: mediaKey }),
    ])

  const onEngineError = useCallback<NonNullable<PlayerServices['onEngineError']>>(
    ({ reason }) => {
      if (reason !== 'locked') return
      setResumeFrom(lastSaved.current)
      void queryClient.invalidateQueries({ queryKey: mediaKey })
    },
    [queryClient, mediaKey],
  )

  // A relock before the first save resumes where this title started, not at 0.
  useEffect(() => {
    if (media.data === undefined) return
    lastSaved.current = resumeAtFor({ at: resumeFrom ?? at, media: media.data })
  }, [media.data, resumeFrom, at])

  useEffect(() => {
    if (media.data === undefined || hasNoted.current) return
    hasNoted.current = true
    requestQuietly({
      client,
      request: {
        type: 'noteServerTitle',
        serverId,
        mediaId: media.data.id,
        label: mediaLabel(media.data),
        watched: shareOf({ position: media.data.position, length: media.data.duration }),
      },
    })
  }, [client, serverId, media.data])

  if (media.isSuccess) {
    return (
      <Ready
        // Each read of the title remounts the player, so an unlock mid-play starts a new load.
        key={media.dataUpdatedAt}
        media={media.data}
        server={server}
        api={api}
        player={player}
        at={resumeFrom ?? at}
        next={next}
        lastSaved={lastSaved}
        length={length}
        hasRecordedPlay={hasRecordedPlay}
        onEngineError={onEngineError}
        onLost={onLost}
      />
    )
  }
  // A read after an unlock keeps the last refusal until it answers, which must not ask again.
  if (!media.isError || media.isFetching) return <Waiting />
  const { error } = media
  if (isLockedError(error)) {
    return (
      <Locked
        // A new refusal asks afresh, even when the last dialog closed on an unlock.
        key={`pin:${media.errorUpdateCount}`}
        secret="pin"
        hint={SERVER_COPY.pinHint(server.name)}
        unlock={(pin) => api.unlock(pin)}
        onUnlocked={reread}
      />
    )
  }
  if (isHidden) {
    if (adminLock.isError) {
      return (
        <CannotRead
          server={server}
          mediaId={mediaId}
          message={adminLock.error.message}
          onRetry={() => void adminLock.refetch()}
        />
      )
    }
    if (adminLock.isPending || adminLock.isFetching) return <Waiting />
    if (adminLock.data.state === 'on' && adminLock.data.available) {
      return (
        <Locked
          key={`adminPassword:${media.errorUpdateCount}`}
          secret="adminPassword"
          hint={SERVER_COPY.adminHint(server.name)}
          unlock={async (password) => {
            // The server's answer is the lock as it now stands, so it is not read again.
            const lock = await api.unlockAdmin(password)
            queryClient.setQueryData(adminKey, lock)
            return lock
          }}
          onUnlocked={reread}
        />
      )
    }
    return <Refused message={SERVER_COPY.gone(server.name)} />
  }
  return (
    <CannotRead
      server={server}
      mediaId={mediaId}
      message={error.message}
      onRetry={() => void media.refetch()}
    />
  )
}

/** The engine main has: the native one plays, and without it the title opens in the browser. */
const ServerTitle = ({ server, mediaId, at, next }: Title) => {
  const chosen = useChosenEngine()
  const [isLost, setIsLost] = useState(false)
  const onLost = useCallback(() => setIsLost(true), [])

  if (chosen === null) return <Waiting />
  if (chosen.status === 'unavailable' || isLost) {
    return <BrowserFallback server={server} mediaId={mediaId} isLost={isLost} />
  }
  return (
    <NativeTitle
      server={server}
      mediaId={mediaId}
      at={at}
      next={next}
      player={chosen.player}
      onLost={onLost}
    />
  )
}

const ServerPage = ({
  serverId,
  mediaId,
  at,
  next,
}: {
  serverId: string
  mediaId: number
  at: number
  next: number[]
}) => {
  const servers = useServers()
  if (servers.data === undefined) {
    return servers.isError ? <Refused message={servers.error.message} /> : <Waiting />
  }
  const server = servers.data.find((each) => each.serverId === serverId)
  if (server === undefined) return <Refused message={SERVER_COPY.unknownServer} />
  return <ServerTitle server={server} mediaId={mediaId} at={at} next={next} />
}

/** Keyed by server and title, so a new title remounts the Player and its unmount saves the old position first. */
export const ServerRoute = () => {
  const { serverId, mediaId: param } = useParams()
  const state: unknown = useLocation().state
  const mediaId = mediaIdOf({ param })
  if (!isOpaqueId(serverId) || mediaId === null) return <Refused message={NOT_OPENABLE} />
  const { at, next } = isServerPlayState(state) ? state : NO_STATE
  return (
    <ServerPage
      key={`${serverId}:${mediaId}`}
      serverId={serverId}
      mediaId={mediaId}
      at={at}
      next={next}
    />
  )
}
