import {
  type ApiClient,
  type MediaItem,
  type MediaTracks,
  type PlayerCommand,
  type PlayerEvent,
  type PlayerSource,
  PLAYER_SOURCE_KINDS,
} from '@raven/core'
import type { ReactNode, RefObject } from 'react'
import type { MediaPlane } from '@/components/Player/useMediaPlane'
import type { VideoState } from '@/components/Player/videoState'

export type EngineActions = {
  play: () => void
  pause: () => void
  seek: (time: number) => void
  setVolume: (level: { volume: number; muted: boolean }) => void
  setRate: (rate: number) => void
  setAudio: (index: number | null) => void
  setSubtitle: (id: string | null) => void
  setSubtitleScale: (scale: number) => void
  /** Only an engine with a video info overlay has one. */
  toggleStats?: () => void
}

/** What the picture is doing right now, for Playback info; null where the engine cannot tell. */
export type EngineStats = {
  /** What plays the video: "HTML video". */
  engine: string
  /** The player's box in CSS pixels, and the screen's pixels to each. */
  viewport: { width: number; height: number; scale: number } | null
  /** The size of the frames being decoded. */
  frame: { width: number; height: number } | null
  /** Since the source was last loaded. */
  frames: { dropped: number; total: number } | null
}

/** The chrome never reaches into the engine's video element. */
export type EngineHandle = {
  state: VideoState
  duration: number | null
  position: RefObject<number>
  tracks: MediaTracks | null
  actions: EngineActions
  surface: ReactNode
  focusSurface: () => void
  drawsSubtitles: boolean
  readStats: () => EngineStats
}

export type HtmlSource =
  | {
      kind: typeof PLAYER_SOURCE_KINDS.server
      media: MediaItem
      api: ApiClient
      mediaPlane?: MediaPlane
    }
  | { kind: typeof PLAYER_SOURCE_KINDS.file; url: string }

/** A player in another process: commands out, each answered once, and events in. */
export type NativePlayer = {
  send: (command: PlayerCommand) => Promise<void>
  subscribe: (listener: (event: PlayerEvent) => void) => () => void
}

/** The browser's own `<video>`, or a player in another process. */
export const ENGINE_KINDS = { html: 'html', native: 'native' } as const

export type Engine =
  | { kind: typeof ENGINE_KINDS.html; source: HtmlSource }
  | { kind: typeof ENGINE_KINDS.native; player: NativePlayer; source: PlayerSource }

/** One key per video, so a different source remounts the native stage. */
export const sourceKey = (source: PlayerSource): string => {
  switch (source.kind) {
    case PLAYER_SOURCE_KINDS.server:
      return `server:${source.serverId}:${source.mediaId}`
    case PLAYER_SOURCE_KINDS.file:
      return `file:${source.fileId}`
    default: {
      const unknown: never = source
      return unknown
    }
  }
}

const reasonOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : 'no reason given'

/**
 * For every command whose refusal the viewer need not be told about: it never
 * throws, and a refusal is logged and handed to `onRefused` to undo what the
 * page showed early.
 */
export const sendQuietly = ({
  player,
  command,
  onAccepted = () => {},
  onRefused = () => {},
}: {
  player: NativePlayer
  command: PlayerCommand
  onAccepted?: () => void
  onRefused?: () => void
}): void => {
  player.send(command).then(onAccepted, (error: unknown) => {
    console.warn(`Raven refused ${command.type}: ${reasonOf(error)}`)
    onRefused()
  })
}
