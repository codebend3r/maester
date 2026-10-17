import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { OutputSettings } from '@raven/core'
import {
  Button,
  type NativePlayer,
  Player,
  PlayerServicesProvider,
  useKeyShortcut,
} from '@raven/ui'
import type { DesktopClient } from '@/renderer/desktop/client'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import {
  isEngineGone,
  isEngineStop,
  type PlayerConnection,
  usePlayerConnection,
} from '@/renderer/desktop/playerConnection'
import styles from '@/renderer/PlayPage/PlayPage.module.scss'
import {
  ENGINE_MOVED,
  type EngineUse,
  isPlayState,
  OUTPUT_KEY,
  servicesFor,
  STATS_UNAVAILABLE,
} from '@/renderer/PlayPage/playerServices'
import { useNotice } from '@/renderer/Shell/Shell'
import { carriesPassthrough } from '@/shared/carriedOutput'
import { fileUrlFor, isOpaqueId, type LocalFile, type MenuPlayerAction } from '@/shared/protocol'

const NOT_OPENABLE = 'raven player can not open that video.'

const Refused = ({ message }: { message: string }) => {
  const navigate = useNavigate()
  const title = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (title.current !== null) title.current.focus()
  }, [])

  return (
    <main className={styles.refused} aria-labelledby="refused-title">
      <header className={styles.bar}>
        <Button icon="back" onClick={() => void navigate('/')}>
          Home
        </Button>
      </header>
      <section className={styles.message}>
        <h1 id="refused-title" tabIndex={-1} ref={title}>
          This video can't be opened
        </h1>
        <p>{message}</p>
      </section>
    </main>
  )
}

type Chosen = Exclude<PlayerConnection, { status: 'waiting' }>

/** Main may take up to its deadline to say which engine it has; the way out stays open. */
const Waiting = () => {
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

/**
 * The native engine, watched for its loss: mpv stopping under the page, or main answering
 * that it has. `onLost` gets where the video was, for the html engine to resume there.
 */
const NativePlaying = ({
  player,
  fileId,
  resumeAt,
  onLost,
}: {
  player: NativePlayer
  fileId: string
  resumeAt: number
  onLost: (at: number) => void
}) => {
  // Refs, so the page itself never renders on `time`.
  const position = useRef(resumeAt)
  // A `time` before the latest load is answered belongs to the file that load replaced.
  const load = useRef({ latest: 0, isAnswered: false })
  const watched = useMemo<NativePlayer>(
    () => ({
      send: (command) => {
        if (command.type === 'seek') position.current = command.time
        if (command.type === 'load') {
          load.current = { latest: load.current.latest + 1, isAnswered: false }
        }
        const sent = load.current.latest
        return player.send(command).then(
          () => {
            if (command.type !== 'load' || sent !== load.current.latest) return
            load.current = { latest: sent, isAnswered: true }
            position.current = command.start
          },
          (error: unknown) => {
            if (isEngineGone(error)) onLost(position.current)
            throw error
          },
        )
      },
      subscribe: player.subscribe,
    }),
    [player, onLost],
  )

  useEffect(
    () =>
      player.subscribe((event) => {
        if (event.type === 'time') {
          if (load.current.isAnswered) position.current = event.time
          return
        }
        if (isEngineStop(event)) onLost(position.current)
      }),
    [player, onLost],
  )

  return <Player engine={{ kind: 'native', player: watched, source: { kind: 'file', fileId } }} />
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
  const showNotice = useNotice()
  const [lostAt, setLostAt] = useState<number | null>(null)
  // The first loss counts: a refusal racing the engine's stop event reports the same moment.
  const onLost = useCallback((at: number) => setLostAt((current) => current ?? at), [])
  const player = chosen.status === 'native' && lostAt === null ? chosen.player : null
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
    () => ({ ...base, isVolumeFixed: isOutputFixed && engine === 'native' }),
    [base, isOutputFixed, engine],
  )

  const onMenu = useEffectEvent((action: MenuPlayerAction) => {
    // The html engine has no overlay, so Video Info says so rather than doing nothing.
    if (action === 'stats' && engine !== 'native') {
      showNotice(STATS_UNAVAILABLE)
      return
    }
    if (action !== 'next' || services.title.next === null) return
    const { to, state } = services.title.next
    void navigate(to, { replace: true, state })
  })

  useEffect(() => menu.subscribe(onMenu), [menu])

  // The html engine focuses its video on mount, so focus lands back in the player.
  useEffect(() => {
    if (lostAt !== null) showNotice(ENGINE_MOVED)
  }, [lostAt, showNotice])

  return (
    <PlayerServicesProvider services={services}>
      {player === null ? (
        <Player engine={{ kind: 'html', source: { kind: 'file', url: fileUrlFor(file.fileId) } }} />
      ) : (
        <NativePlaying
          player={player}
          fileId={file.fileId}
          resumeAt={file.resumeAt}
          onLost={onLost}
        />
      )}
    </PlayerServicesProvider>
  )
}

/** A refused or unreadable answer leaves the volume free, as the default profile does. */
const readOutput = async (client: DesktopClient): Promise<OutputSettings | null> => {
  const reply = await client.request({ type: 'readOutput' })
  return reply.type === 'output' ? reply.output : null
}

const isFixedOutput = (output: OutputSettings | null): boolean =>
  output !== null && carriesPassthrough(output)

/** The engine settles once per video: the first answer main gives, kept until it is lost. */
const useChosenEngine = (): Chosen | null => {
  const connection = usePlayerConnection()
  const [chosen, setChosen] = useState<Chosen | null>(
    connection.status === 'waiting' ? null : connection,
  )
  if (chosen === null && connection.status !== 'waiting') {
    setChosen(connection)
    return connection
  }
  return chosen
}

const PlayPage = ({ fileId, queue }: { fileId: string; queue: string[] }) => {
  const { client } = useDesktop()
  const chosen = useChosenEngine()
  const output = useQuery({
    queryKey: OUTPUT_KEY,
    queryFn: () => readOutput(client),
    staleTime: Infinity,
    retry: false,
  })
  const file = useQuery({
    queryKey: ['desktop', 'file', fileId, queue],
    queryFn: async (): Promise<LocalFile> => {
      const reply = await client.request({ type: 'describeFile', fileId, queue })
      if (reply.type === 'file') return reply.file
      if (reply.type === 'refused') throw new Error(reply.message)
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
  return (
    <Playing file={file.data} chosen={chosen} isOutputFixed={isFixedOutput(output.data ?? null)} />
  )
}

/** Keyed by file, so a new file remounts the Player and its unmount saves the old position first. */
export const PlayRoute = () => {
  const { fileId } = useParams()
  const state: unknown = useLocation().state
  if (!isOpaqueId(fileId)) return <Refused message={NOT_OPENABLE} />
  const queue = isPlayState(state) ? state.queue : []
  return <PlayPage key={fileId} fileId={fileId} queue={queue} />
}
