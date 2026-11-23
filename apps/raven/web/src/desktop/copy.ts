import { UPDATE_WORDS } from '@raven/core'

export const DESKTOP_HOST_COPY = {
  /** The toast for a newer release; Settings' Updates section opens its page. */
  newerRelease: (version: string) => `${UPDATE_WORDS.newer(version)} Settings has what's new.`,
  /** The home server's name in Raven, whose page is on a loopback address that names no server. */
  homeServer: 'raven',
} as const
