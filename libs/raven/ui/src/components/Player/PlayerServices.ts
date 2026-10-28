import type {
  PlaybackDiagnostics,
  PlayerAction,
  PlayerErrorReason,
  ProgressReport,
} from '@raven/core'
import type { IconName } from '@/components/Icon/Icon'

export type ProgressSink = {
  started: () => void
  /** Where playback is, and the audio track playing, for the server's Streams page. */
  save: (report: ProgressReport) => void
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

/** What plays after the title, as the header, the Next button and the up next card offer it. */
export type UpNext = {
  to: string
  state: unknown
  label: string
  /** A pick from a shuffle rather than the next in turn. */
  isShuffled?: boolean
  /** The card's line under the label: "Season 2, Episode 4". */
  detail?: string | null
  /** The card's picture. */
  posterUrl?: string | null
  /** The next season's first episode, after a season played on its own: offered, never played by itself. */
  isNextSeason?: boolean
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
  /** What plays after this one. */
  next: UpNext | null
}

/** A track pick a person made by hand: an audio index and a subtitle id. */
export type TrackChoice = { audio: number | null; subtitle: string | null }

/** Another player that can take this title over, starting at a position in seconds. */
export type Handoff = { label: string; run: (at: number) => void }

/** Where Unplayable's Report this error goes, and the app version the report names. */
export type ErrorReporter = {
  appVersion: string | null
  send: (diagnostics: PlaybackDiagnostics) => Promise<unknown>
}

type OnEngineErrorProps = { reason: PlayerErrorReason; message: string }

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
  /** Without it Unplayable offers no Report this error. */
  report?: ErrorReporter
  /** The native engine's error, before Unplayable shows it, for a host that can recover (a relocked library). */
  onEngineError?: (error: OnEngineErrorProps) => void
}
