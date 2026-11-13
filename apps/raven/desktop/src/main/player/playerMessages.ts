import { ENGINE_STOPPED } from '@raven/core'

export const PLAYER_MESSAGES = {
  notOpen:
    'That video is no longer open. Open it again from the files on this computer or from Downloads.',
  cannotOpen: 'Raven could not open this video.',
  stopped: 'Raven could not keep playing this video.',
  trackStopped: 'Raven could not keep playing this track.',
  engineStopped: ENGINE_STOPPED,
  noTrack: 'That track is not in this video.',
  failed: 'Raven could not do that.',
  unknownCommand: 'Raven does not understand that command.',
  busy: 'Raven is busy. Try again.',
  /** A server title's failure when the server could not say why; the source names the server when it can. */
  lost: 'Raven lost its connection to the server. Where you stopped last is saved there.',
} as const
