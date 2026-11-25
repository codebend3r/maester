import type { AudioBitrate } from '@/contract/streaming'

/** What a track plays from: its download, the server's AAC transcode, or the file itself. */
export const TRACK_STREAM_KINDS = {
  download: 'download',
  transcode: 'transcode',
  file: 'file',
} as const

/** What one track plays from, and the bitrate of a transcode or of a download made from one. */
export type TrackStream =
  | { kind: typeof TRACK_STREAM_KINDS.download; kbps: AudioBitrate | null }
  | { kind: typeof TRACK_STREAM_KINDS.transcode; kbps: AudioBitrate }
  | { kind: typeof TRACK_STREAM_KINDS.file }

/**
 * The stream a browser's host plays by the bitrate it picked: the transcode at `kbps`, or the
 * file when it picked none. A browser plays nothing from a download.
 */
export const trackStreamOf = (kbps: AudioBitrate | null): TrackStream =>
  kbps === null ? { kind: TRACK_STREAM_KINDS.file } : { kind: TRACK_STREAM_KINDS.transcode, kbps }
