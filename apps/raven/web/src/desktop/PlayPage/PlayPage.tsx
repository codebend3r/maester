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
import { ENGINE_KINDS, type PlayerServices, useHostPlayer } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { refusalText } from '@/desktop/client'
import { useIsOutputFixed } from '@/desktop/output'
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

const NOT_OPENABLE = 'Raven cannot open that video.'

/**
 * Where a file that is not playing goes back to when no page of the app is behind it: Back
 * otherwise returns to the page that opened it, Downloads or On this Mac.
 */
const OPENED_FROM = DESKTOP_PATHS.local

const engineUseFor = ({ isNative, isLost }: { isNative: boolean; isLost: boolean }): EngineUse => {
  if (isNative) return ENGINE_USES.native
  return isLost ? ENGINE_USES.stopped : ENGINE_USES.fallback
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

/**
 * A granted file on mpv, or on Chromium's own video through `raven-file://` when mpv never
 * started or stops mid-play, carrying on from where it was.
 */
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
    () => fileServicesFor({ file: played, client, menu, engine }),
    [played, client, menu, engine],
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

const PlayPage = ({ fileId, queue }: { fileId: string; queue: string[] }) => {
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
      throw new Error(refusalText({ reply, fallback: NOT_OPENABLE }))
    },
    // Opening a file also records it as recent and reads its resume point: asking again while it
    // plays (focus, remount, a page reading everything again after a PIN) would move both.
    staleTime: 'static',
    // Coming back to a file later must read its resume point afresh.
    gcTime: 0,
    retry: false,
  })

  if (file.isError) return <PlayerMessage message={file.error.message} fallback={OPENED_FROM} />
  if (file.isPending || chosen === null) {
    return <PlayerMessage message={null} fallback={OPENED_FROM} />
  }
  return <Playing file={file.data} chosen={chosen} isOutputFixed={isOutputFixed} />
}

/**
 * A local file or a download, by the id main granted for it. Keyed by file, so a new file
 * remounts the Player and its unmount saves the old position first.
 */
export const PlayRoute = () => {
  const { fileId } = useParams()
  const state: unknown = useLocation().state
  if (!isOpaqueId(fileId)) return <PlayerMessage message={NOT_OPENABLE} fallback={OPENED_FROM} />
  const queue = isPlayState(state) ? state.queue : []
  return <PlayPage key={fileId} fileId={fileId} queue={queue} />
}
