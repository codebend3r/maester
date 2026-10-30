import {
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  type MediaItem,
  mediaLabel,
  PLAYER_ERROR_REASONS,
  PLAYER_SOURCE_KINDS,
  type PlayerSource,
  readWatchQuery,
  TITLE_REFUSALS,
  watchPathFor,
} from '@raven/core'
import { type NativePlayer, type PlayerServices, useUnlockPrompt } from '@raven/ui/headless'
import { type Query, useQuery } from '@tanstack/react-query'
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { DesktopClient } from '@/desktop/client'
import { handled } from '@/desktop/handled'
import { useIsOutputFixed } from '@/desktop/output'
import { NativePlaying } from '@/desktop/player/NativePlaying'
import { PlayerMessage } from '@/desktop/player/PlayerMessage'
import { fileProgressFor, windowPartsFor } from '@/desktop/player/playerServices'
import { type Chosen, useChosenEngine } from '@/desktop/player/useChosenEngine'
import { useLeaveSignal } from '@/desktop/player/useLeaveSignal'
import { useMenuNext } from '@/desktop/player/useMenuNext'
import { CONNECTION_STATUSES } from '@/desktop/playerConnection'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { mediaQuery } from '@/lib/queries'
import { useDesktop } from '@/stores/desktop'

/** Why a title from the server is not playing: Raven plays them on mpv only. */
export const WATCH_COPY = {
  noEngine: "Raven's video engine did not start, so it cannot play this title.",
  engineStopped:
    "Raven's video engine stopped, so it cannot play this title. Quit Raven and open it again to keep watching.",
  unplayable: 'Raven could not play this title.',
  unreadable: 'Raven could not open this title.',
  tooSlow: 'Raven could not get this title ready in time. Try again in a moment.',
} as const

/**
 * How long the page waits for main to answer `playTitle`, which may wait on the server for the
 * title's first ticket: longer than any of main's own bounded server calls.
 */
export const PLAY_TITLE_WAIT_MS = 30_000

const TOO_SLOW = {
  type: DESKTOP_REPLIES.refused,
  message: WATCH_COPY.tooSlow,
} as const satisfies DesktopReply

/** The title main handed over, played from `resumeAt`; `load` changes for each new load of it. */
type Held = { source: PlayerSource; resumeAt: number; load: number }

/**
 * A title that lost its access mid-play: where the player stood, and the answer from main its
 * next load must outlast.
 */
type Relock = { at: number; after: number }

/** Main's answer to `playTitle`, numbered, so a newer answer is told from the one it replaces. */
type Answer = { reply: DesktopReply; count: number }

/**
 * Once main hands over a title, the page keeps it, so nothing reading every query again (a PIN
 * entered, a download confirmed) asks main again mid-play; a refusal is asked again after a PIN.
 */
const keepsTitle = (query: Query<Answer>) =>
  (query.state.data?.reply.type ?? null) === DESKTOP_REPLIES.title ? 'static' : Infinity

type AskForTitleProps = {
  client: DesktopClient
  request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.playTitle }>
  hasLeft: () => boolean
}

/**
 * Asks main for the title, answering `TOO_SLOW` once `waitMs` passes with no answer. A download
 * main hands over after the page stopped waiting, or after it left, is one the page will never
 * play, so main hears the page left it, or the download would stay marked in use.
 */
const askForTitle = ({ client, request, hasLeft }: AskForTitleProps): Promise<DesktopReply> =>
  new Promise((resolve) => {
    const wait = { isOver: false }
    const timer = setTimeout(() => {
      wait.isOver = true
      resolve(TOO_SLOW)
    }, PLAY_TITLE_WAIT_MS)
    handled(
      client.request(request).then((reply) => {
        clearTimeout(timer)
        const isUnwatched = wait.isOver || hasLeft()
        if (
          isUnwatched &&
          reply.type === DESKTOP_REPLIES.title &&
          reply.source.kind === PLAYER_SOURCE_KINDS.file
        ) {
          handled(
            client.request({ type: DESKTOP_REQUESTS.playbackLeft, fileId: reply.source.fileId }),
          )
        }
        resolve(reply)
      }),
    )
  })

type UseLinkedNextProps = {
  next: number[]
  handed: PlayerServices['title']['next']
}

/** The next title by id alone, as a play link names it: its label is read from the server. */
const useLinkedNext = ({ next, handed }: UseLinkedNextProps): PlayerServices['title']['next'] => {
  const [first, ...rest] = next
  const isNeeded = handed === null && first !== undefined
  const media = useQuery(mediaQuery(isNeeded ? first : null)).data
  if (!isNeeded || media === undefined) return handed
  return {
    to: watchPathFor({ mediaId: media.id, at: 0, next: rest }),
    state: null,
    label: mediaLabel(media),
  }
}

/** Whether the player has a title from main to play, or a line to show while it has none. */
const VIEW_KINDS = { playing: 'playing', message: 'message' } as const

type ViewKind = (typeof VIEW_KINDS)[keyof typeof VIEW_KINDS]

type TitleMessageOfProps = { isError: boolean; isFetching: boolean; reply: DesktopReply | null }

/** What the page says while it holds no title: null while main is still answering. */
const titleMessageOf = ({ isError, isFetching, reply }: TitleMessageOfProps): string | null => {
  if (isError) return WATCH_COPY.unreadable
  if (reply === null || reply.type === DESKTOP_REPLIES.title || isFetching) return null
  if (reply.type === DESKTOP_REPLIES.titleRefused || reply.type === DESKTOP_REPLIES.refused) {
    return reply.message
  }
  return WATCH_COPY.unreadable
}

type TitleViewProps = {
  held: Held | null
  services: PlayerServices
  player: NativePlayer
  message: string | null
  onLost: () => void
}

type HeldTitleProps = TitleViewProps

const HeldTitle = ({ held, services, player, onLost }: HeldTitleProps) =>
  held !== null && (
    <NativePlaying
      key={held.load}
      services={services}
      player={player}
      source={held.source}
      resumeAt={held.resumeAt}
      onLost={onLost}
    />
  )

type TitleMessageProps = TitleViewProps

const TitleMessage = ({ services, message }: TitleMessageProps) => (
  <PlayerMessage message={message} fallback={services.title.backTo} />
)

const TITLE_VIEWS = {
  [VIEW_KINDS.playing]: HeldTitle,
  [VIEW_KINDS.message]: TitleMessage,
} as const satisfies Record<ViewKind, ComponentType<TitleViewProps>>

type WatchTitleProps = {
  services: PlayerServices
  media: MediaItem
  upNext: readonly MediaItem[]
  player: NativePlayer
  isOutputFixed: boolean
  onLost: () => void
}

/**
 * The title on mpv. Main is asked for it with `playTitle`: a ready download plays from this
 * Mac, reporting its spot to main, which sends it on under the account that opened it; anything
 * else plays from the server, reporting through the page's own services as the browser does.
 * A locked library asks for the PIN, then main again, and so does one locked again mid-play,
 * which carries on from where the player stood.
 */
const WatchTitle = ({
  services,
  media,
  upNext,
  player,
  isOutputFixed,
  onLost,
}: WatchTitleProps) => {
  const { client, menu } = useDesktop()
  const askPin = useUnlockPrompt((state) => state.ask)
  const { search } = useLocation()
  // Where to start and what follows, read once per title, so a later read of the video (its
  // position moving, a favourite) never asks main again: the address a play link opened says
  // them, else the page that opened it.
  const [{ at, next }] = useState(() => {
    const asked = readWatchQuery(search)
    return {
      at: asked.at > 0 ? asked.at : services.title.resumeAt,
      next: upNext.length > 0 ? upNext.map(({ id }) => id) : asked.next,
    }
  })
  const nextTitle = useLinkedNext({ next, handed: services.title.next })
  const answers = useRef(0)
  const isGone = useRef(false)
  useEffect(() => {
    isGone.current = false
    return () => {
      isGone.current = true
    }
  }, [])
  const title = useQuery({
    queryKey: [...DESKTOP_QUERY_KEYS.title, media.id, at, next],
    queryFn: async (): Promise<Answer> => {
      const reply = await askForTitle({
        client,
        request: { type: DESKTOP_REQUESTS.playTitle, mediaId: media.id, at, next },
        hasLeft: () => isGone.current,
      })
      answers.current += 1
      return { reply, count: answers.current }
    },
    staleTime: keepsTitle,
    // Coming back to the title later asks main afresh.
    gcTime: 0,
    retry: false,
  })
  const [held, setHeld] = useState<Held | null>(null)
  const [relock, setRelock] = useState<Relock | null>(null)
  // Where the player last saved; where it stood when it left a relock reads from the leave.
  const lastSaved = useRef(at)
  const answer = title.data ?? null
  const reply = answer?.reply ?? null
  const count = answer?.count ?? 0
  if (
    held === null &&
    reply !== null &&
    reply.type === DESKTOP_REPLIES.title &&
    count > (relock?.after ?? 0)
  ) {
    setHeld({
      source: reply.source,
      resumeAt: relock?.at ?? reply.resumeAt,
      load: count,
    })
    setRelock(null)
  }
  // Each locked answer asks for the PIN once; a dismissed prompt is not asked again until main is.
  const lockedAnswer =
    reply !== null &&
    reply.type === DESKTOP_REPLIES.titleRefused &&
    reply.reason === TITLE_REFUSALS.locked
      ? count
      : null
  const { refetch } = title

  useEffect(() => {
    if (lockedAnswer !== null) askPin()
  }, [lockedAnswer, askPin])

  const fileId =
    held !== null && held.source.kind === PLAYER_SOURCE_KINDS.file ? held.source.fileId : null
  useLeaveSignal({ client, fileId })
  // A download's spot goes to main alone: the server hearing it from the page too would count twice.
  const fileProgress = useMemo(
    () => (fileId === null ? null : fileProgressFor({ client, fileId })),
    [client, fileId],
  )

  const onEngineError = useCallback<NonNullable<PlayerServices['onEngineError']>>(
    ({ reason }) => {
      if (reason !== PLAYER_ERROR_REASONS.locked) return
      setRelock({ at: lastSaved.current, after: count })
      setHeld(null)
      handled(refetch())
    },
    [count, refetch],
  )

  const { progress } = services
  const played: PlayerServices = {
    ...services,
    title: { ...services.title, resumeAt: held?.resumeAt ?? at, next: nextTitle },
    progress: fileProgress ?? {
      ...progress,
      save: (report) => {
        lastSaved.current = report.position
        progress.save(report)
      },
      // The player leaves after it reports the error, so a relock carries on from where it stood.
      left: (position) => {
        setRelock((current) => (current === null ? null : { ...current, at: position }))
        progress.left(position)
      },
    },
    ...windowPartsFor({ client, menu }),
    isVolumeFixed: isOutputFixed,
    unplayableNote: WATCH_COPY.unplayable,
    onEngineError,
  }
  useMenuNext({ menu, next: nextTitle })

  const View = TITLE_VIEWS[held === null ? VIEW_KINDS.message : VIEW_KINDS.playing]
  return (
    <View
      held={held}
      services={played}
      player={player}
      message={titleMessageOf({ isError: title.isError, isFetching: title.isFetching, reply })}
      onLost={onLost}
    />
  )
}

type EngineMessageOfProps = { chosen: Chosen | null; isLost: boolean }

/** Why mpv cannot play the title, or null while main is still choosing the engine. */
const engineMessageOf = ({ chosen, isLost }: EngineMessageOfProps): string | null => {
  if (chosen === null) return null
  // mpv stopped under this title, or under one before it: either way it is gone until a relaunch.
  if (isLost || chosen.status === CONNECTION_STATUSES.lost) return WATCH_COPY.engineStopped
  if (chosen.status === CONNECTION_STATUSES.unavailable) return WATCH_COPY.noEngine
  return null
}

type WatchViewProps = {
  services: PlayerServices
  media: MediaItem
  upNext: readonly MediaItem[]
  player: NativePlayer | null
  isOutputFixed: boolean
  message: string | null
  onLost: () => void
}

type WatchingTitleProps = WatchViewProps

const WatchingTitle = ({
  services,
  media,
  upNext,
  player,
  isOutputFixed,
  onLost,
}: WatchingTitleProps) =>
  player !== null && (
    <WatchTitle
      services={services}
      media={media}
      upNext={upNext}
      player={player}
      isOutputFixed={isOutputFixed}
      onLost={onLost}
    />
  )

type EngineMessageProps = WatchViewProps

const EngineMessage = ({ services, message }: EngineMessageProps) => (
  <PlayerMessage message={message} fallback={services.title.backTo} />
)

const WATCH_VIEWS = {
  [VIEW_KINDS.playing]: WatchingTitle,
  [VIEW_KINDS.message]: EngineMessage,
} as const satisfies Record<ViewKind, ComponentType<WatchViewProps>>

type DesktopWatchProps = {
  services: PlayerServices
  media: MediaItem
  upNext: readonly MediaItem[]
}

/**
 * The browser's watch page inside Raven: the same title, progress, next title,
 * favourite, report and escape, with mpv drawing the picture under the page. Without mpv a
 * title from the server does not play, since Raven plays them only there.
 */
export const DesktopWatch = ({ services, media, upNext }: DesktopWatchProps) => {
  const chosen = useChosenEngine()
  // Read while main is asked for the engine, so the volume is settled by the time the video loads.
  const isOutputFixed = useIsOutputFixed()
  const [isLost, setIsLost] = useState(false)
  const onLost = useCallback(() => setIsLost(true), [])
  const player = !isLost && chosen?.status === CONNECTION_STATUSES.native ? chosen.player : null
  const View = WATCH_VIEWS[player === null ? VIEW_KINDS.message : VIEW_KINDS.playing]
  return (
    <View
      services={services}
      media={media}
      upNext={upNext}
      player={player}
      isOutputFixed={isOutputFixed}
      message={engineMessageOf({ chosen, isLost })}
      onLost={onLost}
    />
  )
}
