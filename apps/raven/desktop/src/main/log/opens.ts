import { extname, join } from 'node:path'
import {
  DESKTOP_PLATFORMS,
  DESKTOP_REQUESTS,
  type DesktopPlatform,
  ENVELOPE_KINDS,
  isInvokeEnvelope,
  PLAYER_SOURCE_KINDS,
} from '@raven/core'

export type OpenedTitle =
  | { kind: typeof PLAYER_SOURCE_KINDS.file; path: string }
  | { kind: typeof PLAYER_SOURCE_KINDS.server; serverName: string; mediaId: number }

// Anything else after the last dot is part of a name, which the log never holds.
const EXTENSION = /^\.[a-z0-9]{1,8}$/

/** `open file .mkv`, `open file (no extension)`, `open server title 7 on Vhagar`: never a path or a file name. */
export const openLine = (opened: OpenedTitle): string => {
  switch (opened.kind) {
    case PLAYER_SOURCE_KINDS.file: {
      const extension = extname(opened.path).toLowerCase()
      return `open file ${EXTENSION.test(extension) ? extension : '(no extension)'}`
    }
    case PLAYER_SOURCE_KINDS.server:
      return `open server title ${opened.mediaId} on ${opened.serverName}`
    default: {
      const unreachable: never = opened
      return unreachable
    }
  }
}

type LogsDirForProps = {
  platform: DesktopPlatform
  home: string
  /** The profile in use, the test hook's when it is set. */
  userData: string
  hasUserDataOverride: boolean
}

/**
 * Where the log goes: macOS's logs folder, pinned, or `<userData>/logs`, which is Electron's
 * own on Windows (`%APPDATA%\raven\logs`) and the test hook's everywhere.
 */
export const logsDirFor = ({
  platform,
  home,
  userData,
  hasUserDataOverride,
}: LogsDirForProps): string =>
  platform === DESKTOP_PLATFORMS.mac && !hasUserDataOverride
    ? join(home, 'Library', 'Logs', 'raven')
    : join(userData, 'logs')

/** The file a page asks to describe, which it does as it opens one; null for anything else. */
export const describedFileId = (envelope: unknown): string | null => {
  if (!isInvokeEnvelope(envelope) || envelope.kind !== ENVELOPE_KINDS.page) return null
  const { request } = envelope
  return request.type === DESKTOP_REQUESTS.describeFile ? request.fileId : null
}
