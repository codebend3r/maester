/**
 * The API contract between the media server and every client. Anything a
 * client renders, or the server returns, is one of these shapes, so the web
 * app and a future native app agree on the wire format by construction.
 */

export type ScanState = 'idle' | 'scanning'

export type ScanStatus = {
  state: ScanState
  /** Video files the walk found under the library's paths. */
  discovered: number
  /** Files already indexed: unchanged ones count straight away, new and changed ones once probed. */
  processed: number
  startedAt: string | null
  finishedAt: string | null
  /** The last scan's failure, cleared when the next scan starts. */
  error: string | null
}

export type Library = {
  id: number
  name: string
  /** Absolute folder paths as the server sees them (container paths under Docker). */
  paths: string[]
  itemCount: number
  createdAt: string
  scan: ScanStatus
}

/** What a client sends to create a library or replace its name and paths. */
export type LibraryInput = {
  name: string
  paths: string[]
}

export type ThumbnailState = 'pending' | 'ready' | 'failed'

export type MediaItem = {
  id: number
  libraryId: number
  title: string
  fileName: string
  /** The folder the file sits in, relative to the library path that found it; '' at the root. */
  folder: string
  size: number
  /** Normalised from the file extension: 'mp4', 'mkv', 'webm', 'mov', ... */
  container: string
  /** Seconds, or null until the file has been probed. */
  duration: number | null
  width: number | null
  height: number | null
  /** ffprobe codec names: 'h264', 'hevc', 'vp9', 'av1', ... */
  videoCodec: string | null
  videoBitDepth: number | null
  hdr: boolean
  /** ffprobe codec names: 'aac', 'ac3', 'eac3', 'opus', 'truehd', ... */
  audioCodec: string | null
  audioChannels: number | null
  /** Bits per second across the whole file. */
  bitrate: number | null
  thumbnail: ThumbnailState
  /** Changes whenever the file does, so a thumbnail URL can be cached forever. */
  thumbnailVersion: number
  /** Where playback last stopped, in seconds; 0 when never started or finished. */
  position: number
  favourite: boolean
  addedAt: string
}

export type MediaSort = 'title' | 'added'

export type DirectoryEntry = {
  name: string
  path: string
}

export type DirectoryListing = {
  path: string
  /** null at the browse root, where the server will not go any higher. */
  parent: string | null
  directories: DirectoryEntry[]
}

export type ApiErrorBody = {
  statusCode: number
  message: string | string[]
}
