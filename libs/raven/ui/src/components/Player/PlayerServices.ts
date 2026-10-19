import type { PlayerErrorReason } from '@raven/core'
import type { IconName } from '@/components/Icon/Icon'
import type { PlayerAction } from '@/lib/shortcuts'

export type ProgressSink = {
  started: () => void
  save: (position: number) => void
  left: (position: number) => void
  /** The engine learned how long the video is. */
  duration?: (seconds: number) => void
}

/** A host (the desktop menu, say) that sends the player actions of its own. */
export type HostActions = {
  subscribe: (listener: (action: PlayerAction) => void) => () => void
}

/** The playing video's favourite, for a host that keeps them; the host owns the change. */
export type PlayerFavourite = {
  isFavourite: boolean
  toggle: () => void
}

export type PlayerTitle = {
  label: string
  /**
   * Where the title came from, which the line under it names before how it plays:
   * "Downloaded from Vhagar · Direct play". Left out, the line names no source.
   */
  context?: string | null
  duration: number | null
  resumeAt: number
  backTo: string
  /** What plays after this one; `isShuffled` for a pick from a shuffle rather than the next in turn. */
  next: { to: string; state: unknown; label: string; isShuffled?: boolean } | null
}

/** A track pick a person made by hand: an audio index and a subtitle id. */
export type TrackChoice = { audio: number | null; subtitle: string | null }

/** Another player that can take this title over, starting at a position in seconds. */
export type Handoff = { label: string; run: (at: number) => void }

export type PlayerServices = {
  title: PlayerTitle
  progress: ProgressSink
  posterUrl: string | null
  escape: { label: string; run: () => void; icon?: IconName } | null
  /** Under Unplayable's escape. Left out: the VLC and IINA hint; null: none. */
  escapeHint?: string | null
  /** The host owns feedback from its escape action, including clipboard failures. */
  escapeFeedback?: string | null
  hostActions?: HostActions
  /** Without it the player shows no heart, as a local file has no favourite. */
  favourite?: PlayerFavourite
  /** The host remembers picks by hand: where to start, and where to save the next. */
  trackPicks?: { start: TrackChoice | null; save: (choice: TrackChoice) => void }
  /** Told when the controls show and hide (the desktop's traffic lights follow them). */
  chrome?: { shown: (isShown: boolean) => void }
  /** The output carries the bitstream untouched, so volume and mute do nothing. */
  isVolumeFixed?: boolean
  /** Replaces Unplayable's "This video can't play in this browser." */
  unplayableNote?: string
  /** Plays this title in another player: Unplayable's first action, and a row in the Playback menu. */
  handoff?: Handoff
  /** The native engine's error, before Unplayable shows it, for a host that can recover (a relocked library). */
  onEngineError?: (error: { reason: PlayerErrorReason; message: string }) => void
}
