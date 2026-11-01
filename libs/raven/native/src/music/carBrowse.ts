import type { AUDIO_PLAYER_EVENTS, AudioPlayerEvent } from '@raven/audio/contract'

/** What CarPlay or Android Auto asked for: a list to browse, or a node to play. */
export type BrowseRequest = Extract<AudioPlayerEvent, { type: typeof AUDIO_PLAYER_EVENTS.browse }>
export type PlayRequest = Extract<
  AudioPlayerEvent,
  { type: typeof AUDIO_PLAYER_EVENTS.playFromBrowse }
>

/**
 * How an app answers the car: `browse` replies through `audioPlayer.answerBrowse` with the
 * request's own id, and `play` fills the queue. An app with no car answers nothing, and native
 * falls back to its cache after its wait.
 */
export type CarBrowse = {
  browse: (request: BrowseRequest) => void
  play: (request: PlayRequest) => void
}

export const NO_CAR_BROWSE: CarBrowse = { browse: () => undefined, play: () => undefined }
