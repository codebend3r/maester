import type {
  ApiClient,
  MediaItem,
  MediaTracks,
  PlayerCommand,
  PlayerEvent,
  PlayerSource,
} from '@raven/core'
import type { ReactNode, RefObject } from 'react'
import type { VideoState } from '@/components/Player/useVideoState'

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
  | { kind: 'server'; media: MediaItem; api: ApiClient }
  | { kind: 'file'; url: string }

/** A player in another process: commands out, each answered once, and events in. */
export type NativePlayer = {
  send: (command: PlayerCommand) => Promise<void>
  subscribe: (listener: (event: PlayerEvent) => void) => () => void
}

export type Engine =
  | { kind: 'html'; source: HtmlSource }
  | { kind: 'native'; player: NativePlayer; source: PlayerSource }

/** One key per video, so a different source remounts the native stage. */
export const sourceKey = (source: PlayerSource): string => {
  switch (source.kind) {
    case 'server':
      return `server:${source.serverId}:${source.mediaId}`
    case 'file':
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
    console.warn(`raven player refused ${command.type}: ${reasonOf(error)}`)
    onRefused()
  })
}
