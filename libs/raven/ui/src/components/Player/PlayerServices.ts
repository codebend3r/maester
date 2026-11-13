import type {
  MediaMarkers,
  PlaybackDiagnostics,
  PlayerAction,
  PlayerErrorReason,
  ProgressReport,
} from '@raven/core'
import type { IconName } from '@/components/Icon/drawings'

export type ProgressSink = {
  started: () => void
  /** Where playback is, and the audio track playing, for the server's Streams page. */
  save: (report: ProgressReport) => void
  left: (position: number) => void
  /** The engine learned how long the video is; null for a host that does not ask. */
  duration: ((seconds: number) => void) | null
}

/** A host (the desktop menu, say) that sends the player actions of its own. */
export type HostActions = {
  subscribe: (listener: (action: PlayerAction) => void) => () => void
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

/** The title's art, drawn in the header in place of its name. */
export type TitleLogo = {
  url: string
  /** The name the art spells out, read in its place: a film's, or an episode's show's. */
  name: string
}

export type PlayerTitle = {
  label: string
  /** The title's art for the header; null, the label is spelled out. */
  logo: TitleLogo | null
  /**
   * The page the header's title links to: an episode's show's, a film's own.
   * Null, as for a local file, the title links nowhere.
   */
  homeTo: string | null
  /**
   * Where the title came from, which the line under it names before how it plays:
   * "Downloaded from Vhagar · Direct play". Null, the line names no source.
   */
  context: string | null
  duration: number | null
  resumeAt: number
  backTo: string
  /** What plays after this one. */
  next: UpNext | null
  /** The file's intro, credits and chapters; null while unknown, as for a local file. */
  markers: MediaMarkers | null
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

export type EngineError = { reason: PlayerErrorReason; message: string }

/** Unplayable's way out: copying the file's address, say, with its button's icon. */
export type PlayerEscape = { label: string; run: () => void; icon: IconName }

/** The picks by hand a host remembers: where to start, and where to save the next. */
export type TrackPicks = { start: TrackChoice | null; save: (choice: TrackChoice) => void }

/** Told when the controls show and hide (the desktop's traffic lights follow them). */
export type HostChrome = { shown: (isShown: boolean) => void }

export type PlayerServices = {
  title: PlayerTitle
  progress: ProgressSink
  posterUrl: string | null
  escape: PlayerEscape | null
  /** The host owns feedback from its escape action, including clipboard failures; null for none. */
  escapeFeedback: string | null
  hostActions: HostActions | null
  trackPicks: TrackPicks | null
  chrome: HostChrome | null
  /** The output carries the bitstream untouched, so volume and mute do nothing. */
  isVolumeFixed: boolean
  /** Replaces Unplayable's "This video can't play in this browser."; null keeps it. */
  unplayableNote: string | null
  /** Plays this title in another player: Unplayable's first action, and a row in the Playback menu. */
  handoff: Handoff | null
  /** Null: Unplayable offers no Report this error. */
  report: ErrorReporter | null
  /** The native engine's error, before Unplayable shows it, for a host that can recover (a relocked library). */
  onEngineError: ((error: EngineError) => void) | null
}

/** What a host that offers none of the extras passes: spread it, then name what it does offer. */
export const NO_HOST_EXTRAS = {
  escapeFeedback: null,
  hostActions: null,
  trackPicks: null,
  chrome: null,
  isVolumeFixed: false,
  unplayableNote: null,
  handoff: null,
  report: null,
  onEngineError: null,
} as const satisfies Partial<PlayerServices>

/** What a title with nothing beyond its label, length and way back passes: spread it, then name the rest. */
export const NO_TITLE_EXTRAS = {
  logo: null,
  homeTo: null,
  context: null,
  markers: null,
} as const satisfies Partial<PlayerTitle>
