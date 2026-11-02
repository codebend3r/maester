import {
  DESKTOP_PATHS,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  fileUrlFor,
  isOpaqueId,
  type LocalFile,
  MENU_PLAYER_ACTIONS,
  type MenuPlayerAction,
  PLAYER_SOURCE_KINDS,
} from '@raven/core'
import { Player, useToasts } from '@raven/ui'
import {
  ENGINE_KINDS,
  type NativePlayer,
  type PlayerServices,
  useHostPlayer,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { refusalText } from '@/desktop/client'
import { type DownloadsPage, playOriginFor } from '@/desktop/paths'
import { useIsOutputFixed } from '@/desktop/output'
import { PLAY_PAGE_COPY } from '@/desktop/PlayPage/copy'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { NativePlaying } from '@/desktop/player/NativePlaying'
import { PlayerMessage } from '@/desktop/player/PlayerMessage'
import {
  ENGINE_MOVED,
  ENGINE_USES,
  type EngineUse,
  fileServicesFor,
  isPlayState,
  STATS_UNAVAILABLE,
} from '@/desktop/player/playerServices'
import { type Chosen, useChosenEngine } from '@/desktop/player/useChosenEngine'
import { useLeaveSignal } from '@/desktop/player/useLeaveSignal'
import { useMenuNext } from '@/desktop/player/useMenuNext'
import { CONNECTION_STATUSES } from '@/desktop/playerConnection'
import { useDesktop } from '@/stores/desktop'

/**
 * Where a file that is not playing goes back to when no page of the app is behind it: Back
 * otherwise returns to the page that opened it, Downloads or On this Mac.
 */
const OPENED_FROM = DESKTOP_PATHS.local

type EngineUseForProps = { isNative: boolean; isLost: boolean }

const engineUseFor = ({ isNative, isLost }: EngineUseForProps): EngineUse => {
  if (isNative) return ENGINE_USES.native
  return isLost ? ENGINE_USES.stopped : ENGINE_USES.fallback
}

type HtmlPlayingProps = { services: PlayerServices; fileId: string }

/** The html engine, a host of its own: a loss mounts it, on the services that carry on from there. */
const HtmlPlaying = ({ services, fileId }: HtmlPlayingProps) => {
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

type EngineViewProps = {
  services: PlayerServices
  file: LocalFile
  player: NativePlayer | null
  onLost: (at: number) => void
}

type NativeFilePlayingProps = EngineViewProps

const NativeFilePlaying = ({ services, file, player, onLost }: NativeFilePlayingProps) =>
  player !== null && (
    <NativePlaying
      services={services}
      player={player}
      source={{ kind: PLAYER_SOURCE_KINDS.file, fileId: file.fileId }}
      resumeAt={file.resumeAt}
      onLost={onLost}
    />
  )

type HtmlFilePlayingProps = EngineViewProps

const HtmlFilePlaying = ({ services, file }: HtmlFilePlayingProps) => (
  <HtmlPlaying services={services} fileId={file.fileId} />
)

/** mpv while it plays, and Chromium's own video when it never started or stopped. */
const ENGINE_VIEWS = {
  [ENGINE_USES.native]: NativeFilePlaying,
  [ENGINE_USES.fallback]: HtmlFilePlaying,
  [ENGINE_USES.stopped]: HtmlFilePlaying,
} as const satisfies Record<EngineUse, ComponentType<EngineViewProps>>

type PlayingProps = {
  file: LocalFile
  chosen: Chosen
  isOutputFixed: boolean
  downloadsPage: DownloadsPage
}

/**
 * A granted file on mpv, or on Chromium's own video through `raven-file://` when mpv never
 * started or stops mid-play, carrying on from where it was.
 */
const Playing = ({ file, chosen, isOutputFixed, downloadsPage }: PlayingProps) => {
  const { client, menu } = useDesktop()
  const showNotice = useToasts((state) => state.show)
  const [lostAt, setLostAt] = useState<number | null>(null)
  // The first loss counts: a refusal racing the engine's stop event reports the same moment.
  const onLost = useCallback((at: number) => setLostAt((current) => current ?? at), [])
  const player =
    chosen.status === CONNECTION_STATUSES.native && lostAt === null ? chosen.player : null
  // A connection already lost before this video is the engine that stopped, not one never had.
  const isLost = lostAt !== null || chosen.status === CONNECTION_STATUSES.lost
  const engine = engineUseFor({ isNative: player !== null, isLost })
  const played = useMemo(
    () => (lostAt === null ? file : { ...file, resumeAt: lostAt }),
    [file, lostAt],
  )
  const base = useMemo(
    () => fileServicesFor({ file: played, client, menu, engine, downloadsPage }),
    [played, client, menu, engine, downloadsPage],
  )
  // The output arrives on its own time; folding it in keeps the progress sink, so the
  // player neither remounts nor forgets the length it reported.
  // Chromium mixes the html engine's sound itself, so only mpv's bitstream fixes the volume.
  const services = useMemo(
    () => ({ ...base, isVolumeFixed: isOutputFixed && engine === ENGINE_USES.native }),
    [base, isOutputFixed, engine],
  )

  useMenuNext({
    menu,
    next: services.title.next,
    // The html engine has no overlay, so Video Info says so rather than doing nothing.
    onAction: (action: MenuPlayerAction) => {
      if (action === MENU_PLAYER_ACTIONS.stats && engine !== ENGINE_USES.native) {
        showNotice(STATS_UNAVAILABLE)
      }
    },
  })

  useEffect(() => {
    if (lostAt !== null) showNotice(ENGINE_MOVED)
  }, [lostAt, showNotice])

  const View = ENGINE_VIEWS[engine]
  return <View services={services} file={file} player={player} onLost={onLost} />
}

/** Whether the file is ready to play, or the page has a line to show instead. */
const PAGE_KINDS = { playing: 'playing', message: 'message' } as const

type PageKind = (typeof PAGE_KINDS)[keyof typeof PAGE_KINDS]

type PageViewProps = {
  file: LocalFile | null
  chosen: Chosen | null
  isOutputFixed: boolean
  message: string | null
  downloadsPage: DownloadsPage
}

type ReadyFileProps = PageViewProps

const ReadyFile = ({ file, chosen, isOutputFixed, downloadsPage }: ReadyFileProps) =>
  file !== null &&
  chosen !== null && (
    <Playing
      file={file}
      chosen={chosen}
      isOutputFixed={isOutputFixed}
      downloadsPage={downloadsPage}
    />
  )

type FileMessageProps = PageViewProps

const FileMessage = ({ message }: FileMessageProps) => (
  <PlayerMessage message={message} fallback={OPENED_FROM} />
)

const PAGE_VIEWS = {
  [PAGE_KINDS.playing]: ReadyFile,
  [PAGE_KINDS.message]: FileMessage,
} as const satisfies Record<PageKind, ComponentType<PageViewProps>>

type PlayPageProps = { fileId: string; queue: string[]; downloadsPage: DownloadsPage }

const PlayPage = ({ fileId, queue, downloadsPage }: PlayPageProps) => {
  const { client } = useDesktop()
  useLeaveSignal({ client, fileId })
  const chosen = useChosenEngine()
  // Read beside the file, so the volume is settled by the time the video loads.
  const isOutputFixed = useIsOutputFixed()
  const file = useQuery({
    queryKey: [...DESKTOP_QUERY_KEYS.file, fileId, queue],
    queryFn: async (): Promise<LocalFile> => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.describeFile, fileId, queue })
      if (reply.type === DESKTOP_REPLIES.file) return reply.file
      throw new Error(refusalText({ reply, fallback: PLAY_PAGE_COPY.notOpenable }))
    },
    // Opening a file also records it as recent and reads its resume point: asking again while it
    // plays (focus, remount, a page reading everything again after a PIN) would move both.
    staleTime: 'static',
    // Coming back to a file later must read its resume point afresh.
    gcTime: 0,
    retry: false,
  })

  const isReady = file.isSuccess && chosen !== null
  const View = PAGE_VIEWS[isReady ? PAGE_KINDS.playing : PAGE_KINDS.message]
  return (
    <View
      file={file.data ?? null}
      chosen={chosen}
      isOutputFixed={isOutputFixed}
      message={file.isError ? file.error.message : null}
      downloadsPage={downloadsPage}
    />
  )
}

/** Whether main granted an id for the file, so it can be asked for. */
const ROUTE_KINDS = { granted: 'granted', invalid: 'invalid' } as const

type RouteKind = (typeof ROUTE_KINDS)[keyof typeof ROUTE_KINDS]

type RouteViewProps = {
  fileId: string | undefined
  queue: string[]
  downloadsPage: DownloadsPage
}

type GrantedFileProps = RouteViewProps

const GrantedFile = ({ fileId, queue, downloadsPage }: GrantedFileProps) =>
  isOpaqueId(fileId) && (
    <PlayPage key={fileId} fileId={fileId} queue={queue} downloadsPage={downloadsPage} />
  )

const InvalidFile = () => (
  <PlayerMessage message={PLAY_PAGE_COPY.notOpenable} fallback={OPENED_FROM} />
)

const ROUTE_VIEWS = {
  [ROUTE_KINDS.granted]: GrantedFile,
  [ROUTE_KINDS.invalid]: InvalidFile,
} as const satisfies Record<RouteKind, ComponentType<RouteViewProps>>

/**
 * A local file or a download, by the id main granted for it. Keyed by file, so a new file
 * remounts the Player and its unmount saves the old position first.
 */
export const PlayRoute = () => {
  const { fileId } = useParams()
  const location = useLocation()
  const state: unknown = location.state
  const queue = isPlayState(state) ? state.queue : []
  const View = ROUTE_VIEWS[isOpaqueId(fileId) ? ROUTE_KINDS.granted : ROUTE_KINDS.invalid]
  return (
    <View
      fileId={fileId}
      queue={queue}
      downloadsPage={playOriginFor({ state, pathname: location.pathname })}
    />
  )
}
