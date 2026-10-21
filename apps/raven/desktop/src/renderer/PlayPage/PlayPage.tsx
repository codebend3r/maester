import { useQuery } from '@tanstack/react-query'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { type OutputSettings, PLAYER_SOURCE_KINDS } from '@raven/core'
import { Button, Player, useKeyShortcut } from '@raven/ui'
import { ENGINE_KINDS, type PlayerServices, useHostPlayer } from '@raven/ui/headless'
import type { DesktopClient } from '@/renderer/desktop/client'
import { CONNECTION_STATUSES } from '@/renderer/desktop/playerConnection'
import { NativePlaying } from '@/renderer/PlayPage/NativePlaying'
import styles from '@/renderer/PlayPage/PlayPage.module.scss'
import {
  ENGINE_MOVED,
  ENGINE_USES,
  type EngineUse,
  isPlayState,
  OUTPUT_KEY,
  requestQuietly,
  servicesFor,
  STATS_UNAVAILABLE,
} from '@/renderer/PlayPage/playerServices'
import { type Chosen, useChosenEngine } from '@/renderer/PlayPage/useChosenEngine'
import { useDesktop } from '@/renderer/stores/desktop'
import { useNotice } from '@/renderer/stores/notice'
import { carriesPassthrough } from '@/shared/carriedOutput'
import {
  DESKTOP_REQUESTS,
  DESKTOP_REPLIES,
  fileUrlFor,
  isOpaqueId,
  type LocalFile,
  MENU_PLAYER_ACTIONS,
  type MenuPlayerAction,
} from '@/shared/protocol'

const NOT_OPENABLE = 'raven player cannot open that video.'

/** Why a video cannot be opened, with the way Home and whatever else the page offers. */
export const Refused = ({
  title = "This video can't be opened",
  message,
  isHeadingFocused = true,
  children,
}: {
  title?: string
  message: string
  /** False when a field among the children takes the cursor itself, as a sign in form's does. */
  isHeadingFocused?: boolean
  children?: ReactNode
}) => {
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (isHeadingFocused && heading.current !== null) heading.current.focus()
  }, [isHeadingFocused])

  return (
    <main className={styles.refused} aria-labelledby="refused-title">
      <header className={styles.bar}>
        <Button icon="back" onClick={() => void navigate('/')}>
          Home
        </Button>
      </header>
      <section className={styles.message}>
        <h1 id="refused-title" tabIndex={-1} ref={heading}>
          {title}
        </h1>
        <p>{message}</p>
        {children}
      </section>
    </main>
  )
}

/** Main may take up to its deadline to say which engine it has; the way out stays open. */
export const Waiting = () => {
  const navigate = useNavigate()
  const goHome = useCallback(() => void navigate('/'), [navigate])
  useKeyShortcut({ key: 'escape', onPress: goHome })
  return (
    <main className={styles.waiting} aria-busy="true" aria-label="Opening video">
      <header className={styles.bar}>
        <Button icon="back" onClick={goHome}>
          Back
        </Button>
      </header>
    </main>
  )
}

const engineUseFor = ({ isNative, isLost }: { isNative: boolean; isLost: boolean }): EngineUse => {
  if (isNative) return 'native'
  return isLost ? 'stopped' : 'fallback'
}

const Playing = ({
  file,
  chosen,
  isOutputFixed,
}: {
  file: LocalFile
  chosen: Chosen
  isOutputFixed: boolean
}) => {
  const { client, menu } = useDesktop()
  const navigate = useNavigate()
  const showNotice = useNotice((state) => state.show)
  const [lostAt, setLostAt] = useState<number | null>(null)
  // The first loss counts: a refusal racing the engine's stop event reports the same moment.
  const onLost = useCallback((at: number) => setLostAt((current) => current ?? at), [])
  const player =
    chosen.status === CONNECTION_STATUSES.native && lostAt === null ? chosen.player : null
  const engine = engineUseFor({ isNative: player !== null, isLost: lostAt !== null })
  const played = useMemo(
    () => (lostAt === null ? file : { ...file, resumeAt: lostAt }),
    [file, lostAt],
  )
  const base = useMemo(
    () => servicesFor({ file: played, client, menu, engine }),
    [played, client, menu, engine],
  )
  // The output arrives on its own time; folding it in keeps the progress sink, so the
  // player neither remounts nor forgets the length it reported.
  // Chromium mixes the html engine's sound itself, so only mpv's bitstream fixes the volume.
  const services = useMemo(
    () => ({ ...base, isVolumeFixed: isOutputFixed && engine === ENGINE_USES.native }),
    [base, isOutputFixed, engine],
  )

  const onMenu = useEffectEvent((action: MenuPlayerAction) => {
    // The html engine has no overlay, so Video Info says so rather than doing nothing.
    if (action === MENU_PLAYER_ACTIONS.stats && engine !== ENGINE_USES.native) {
      showNotice(STATS_UNAVAILABLE)
      return
    }
    if (action !== MENU_PLAYER_ACTIONS.next || services.title.next === null) return
    const { to, state } = services.title.next
    void navigate(to, { replace: true, state })
  })

  useEffect(() => menu.subscribe(onMenu), [menu])

  // The html engine focuses its video on mount, so focus lands back in the player.
  useEffect(() => {
    if (lostAt !== null) showNotice(ENGINE_MOVED)
  }, [lostAt, showNotice])

  return player === null ? (
    <HtmlPlaying services={services} fileId={file.fileId} />
  ) : (
    <NativePlaying
      services={services}
      player={player}
      source={{ kind: PLAYER_SOURCE_KINDS.file, fileId: file.fileId }}
      resumeAt={file.resumeAt}
      onLost={onLost}
    />
  )
}

/** The html engine, a host of its own: a loss mounts it, on the services that carry on from there. */
const HtmlPlaying = ({ services, fileId }: { services: PlayerServices; fileId: string }) => {
  const isHosting = useHostPlayer(services)
  return (
    isHosting && (
      <Player
        engine={{
          kind: ENGINE_KINDS.html,
          source: { kind: PLAYER_SOURCE_KINDS.file, url: fileUrlFor(fileId) },
        }}
      />
    )
  )
}

/** A refused or unreadable answer leaves the volume free, as the default profile does. */
const readOutput = async ({
  client,
}: {
  client: DesktopClient
}): Promise<OutputSettings | null> => {
  const reply = await client.request({ type: DESKTOP_REQUESTS.readOutput })
  return reply.type === DESKTOP_REPLIES.output ? reply.output : null
}

/** Whether "This computer" sends the bitstream untouched, which leaves mpv's volume nothing to do. */
export const useIsOutputFixed = (): boolean => {
  const { client } = useDesktop()
  const output = useQuery({
    queryKey: OUTPUT_KEY,
    queryFn: () => readOutput({ client }),
    staleTime: Infinity,
    retry: false,
  })
  const settings = output.data ?? null
  return settings !== null && carriesPassthrough(settings)
}

/**
 * Tells main the page left its file, so a deletion that waited for the player can run. React
 * runs this cleanup before the Player's, whose unmount saves where it was, so the leave waits
 * a turn for main to read that position first; StrictMode's remount in that turn takes it back.
 * It relies on `PlayRoute`'s `key={fileId}`: a new file mounts a new page, since a rerun of
 * this effect for another file in the same page would take back the old file's leave.
 */
const useLeaveSignal = ({ client, fileId }: { client: DesktopClient; fileId: string }) => {
  const leaving = useRef<symbol | null>(null)
  useEffect(() => {
    leaving.current = null
    return () => {
      const leave = Symbol('leave')
      leaving.current = leave
      queueMicrotask(() => {
        if (leaving.current !== leave) return
        requestQuietly({ client, request: { type: DESKTOP_REQUESTS.playbackLeft, fileId } })
      })
    }
  }, [client, fileId])
}

const PlayPage = ({ fileId, queue }: { fileId: string; queue: string[] }) => {
  const { client } = useDesktop()
  useLeaveSignal({ client, fileId })
  const chosen = useChosenEngine()
  const isOutputFixed = useIsOutputFixed()
  const file = useQuery({
    queryKey: ['desktop', 'file', fileId, queue],
    queryFn: async (): Promise<LocalFile> => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.describeFile, fileId, queue })
      if (reply.type === DESKTOP_REPLIES.file) return reply.file
      if (reply.type === DESKTOP_REPLIES.refused) throw new Error(reply.message)
      throw new Error(NOT_OPENABLE)
    },
    // Opening a file also records it as recent and reads its resume point:
    // asking again while it plays (focus, remount) would move both.
    staleTime: Infinity,
    // Coming back to a file later must read its resume point afresh.
    gcTime: 0,
    retry: false,
  })

  if (file.isError) return <Refused message={file.error.message} />
  if (file.isPending || chosen === null) return <Waiting />
  return <Playing file={file.data} chosen={chosen} isOutputFixed={isOutputFixed} />
}

/** Keyed by file, so a new file remounts the Player and its unmount saves the old position first. */
export const PlayRoute = () => {
  const { fileId } = useParams()
  const state: unknown = useLocation().state
  if (!isOpaqueId(fileId)) return <Refused message={NOT_OPENABLE} />
  const queue = isPlayState(state) ? state.queue : []
  return <PlayPage key={fileId} fileId={fileId} queue={queue} />
}
