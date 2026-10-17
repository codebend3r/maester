import type { ApiClient, MediaItem, MediaTracks } from '@raven/core'
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

export type Engine = { kind: 'html'; source: HtmlSource }
