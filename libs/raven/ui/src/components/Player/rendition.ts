import { PLAYBACK_MODES, type PlaybackMode, type StreamQuality } from '@raven/core'

/** What is playing: the way, and for a transcode the size asked of it (null for the server's settings). */
export type Rendition = {
  mode: PlaybackMode
  quality: StreamQuality | null
  /** A transcode's picture subtitle, by track id, burned into the picture. */
  burn: string | null
}

export const DIRECT_RENDITION = {
  mode: PLAYBACK_MODES.direct,
  quality: null,
  burn: null,
} as const satisfies Rendition
