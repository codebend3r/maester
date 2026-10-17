import { extname, join } from 'node:path'
import { isInvokeEnvelope } from '@/shared/protocol'

export type OpenedTitle =
  | { kind: 'file'; path: string }
  | { kind: 'server'; serverName: string; mediaId: number }

// Anything else after the last dot is part of a name, which the log never holds.
const EXTENSION = /^\.[a-z0-9]{1,8}$/

/** `open file .mkv`, `open file (no extension)`, `open server title 7 on Vhagar`: never a path or a file name. */
export const openLine = (opened: OpenedTitle): string => {
  switch (opened.kind) {
    case 'file': {
      const extension = extname(opened.path).toLowerCase()
      return `open file ${EXTENSION.test(extension) ? extension : '(no extension)'}`
    }
    case 'server':
      return `open server title ${opened.mediaId} on ${opened.serverName}`
    default: {
      const unreachable: never = opened
      return unreachable
    }
  }
}

/** Where the log goes: Electron's pinned logs path, or `<userData>/logs` under the test hook. */
export const logsDirFor = ({
  home,
  userDataOverride,
}: {
  home: string
  userDataOverride: string | null
}): string =>
  userDataOverride === null
    ? join(home, 'Library', 'Logs', 'raven')
    : join(userDataOverride, 'logs')

/** The file a page asks to describe, which it does as it opens one; null for anything else. */
export const describedFileId = (envelope: unknown): string | null => {
  if (!isInvokeEnvelope(envelope) || envelope.kind !== 'page') return null
  const { request } = envelope
  return request.type === 'describeFile' ? request.fileId : null
}
