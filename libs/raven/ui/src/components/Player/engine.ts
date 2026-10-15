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
}

export type HtmlSource =
  | { kind: 'server'; media: MediaItem; api: ApiClient }
  | { kind: 'file'; url: string }

export type Engine = { kind: 'html'; source: HtmlSource }
