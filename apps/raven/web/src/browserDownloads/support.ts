/** The parts of `window` that say whether this browser can keep downloads. */
export type DownloadsWindow = {
  isSecureContext: boolean
  navigator: { storage?: { getDirectory?: unknown } }
  FileSystemFileHandle?: { prototype: object }
}

const WRITABLE = 'createWritable'

/**
 * Whether this browser can keep a video: a secure context with the Origin Private File System
 * and a file it can write to from the page (Safari grew `createWritable` after the rest). A
 * browser without them gets no Download button and no Downloads page.
 */
export const canKeepDownloads = ({
  isSecureContext,
  navigator,
  FileSystemFileHandle,
}: DownloadsWindow): boolean =>
  isSecureContext &&
  typeof (navigator.storage?.getDirectory ?? null) === 'function' &&
  WRITABLE in (FileSystemFileHandle?.prototype ?? {})
