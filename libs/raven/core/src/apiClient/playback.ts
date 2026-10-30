import { type MediaAccess, type TicketedOrigin, type Transport } from '@/apiClient/transport'
import {
  HLS_PARAMS,
  HLS_PATHS,
  isLiveStreamList,
  isMediaOrigins,
  isMediaStreams,
  isMediaTicket,
  isMediaTracks,
  type LiveStream,
  MEDIA_PROBE_BYTES,
  type MediaOrigin,
  type MediaOrigins,
  type MediaStreams,
  type MediaTicket,
  type MediaTracks,
  type StreamMode,
  type StreamQuality,
  type SubtitleCue,
} from '@/contract'
import { parseWebVtt } from '@/subtitles'

type FileUrlProps = { id: number; access?: MediaAccess | null }

type PingUrlProps = {
  origin: MediaOrigin
  bytes?: number
}

type GetSubtitlesProps = {
  id: number
  trackId: string
  window?: number
  access?: TicketedOrigin | null
}

type HlsUrlProps = {
  id: number
  mode: StreamMode
  audio: number | null
  quality: StreamQuality | null
  access: MediaAccess | null
  /** A transcode's picture subtitle to burn into the picture, by track id; null for none. */
  burn?: string | null
}

type StreamUrlProps = {
  id: number
  mode: StreamMode
  start: number
  audio: number | null
  quality?: StreamQuality | null
  access?: MediaAccess | null
  /** A transcode's picture subtitle to burn into the picture, by track id; null for none. */
  burn?: string | null
}

/** What a player loads: the file, its tracks and streams, the origins and tickets that open them, and the admin's view of who is streaming. */
export const playbackCalls = ({ url, mediaUrl, send, sendForText, expect }: Transport) => ({
  /** The original file, served with byte ranges: what a player loads for direct play. */
  fileUrl: ({ id, access = null }: FileUrlProps): string =>
    mediaUrl({ path: `/api/media/${id}/file`, query: {}, access }),

  /** The server's event stream: `ServerEvent`s, read with `parseServerEvent`. */
  eventsUrl: (): string => url('/api/events'),

  /** The audio and subtitle tracks a player can choose between. */
  getTracks: (id: number): Promise<MediaTracks> =>
    expect({ request: send({ path: `/api/media/${id}/tracks` }), guard: isMediaTracks }),

  /** The file's picture and sound in detail, probed afresh each time: profiles, bitrates, sample rates. */
  getStreams: (id: number): Promise<MediaStreams> =>
    expect({ request: send({ path: `/api/media/${id}/streams` }), guard: isMediaStreams }),

  /** The origins a browser may fetch media from directly, best first; none while tickets are off. */
  getMediaOrigins: (): Promise<MediaOrigins> =>
    expect({ request: send({ path: '/api/media-origins' }), guard: isMediaOrigins }),

  /** A short-lived ticket that stands in for the cookie on this video's media requests to another origin. */
  getMediaTicket: (id: number): Promise<MediaTicket> =>
    expect({ request: send({ path: `/api/media/${id}/ticket` }), guard: isMediaTicket }),

  /** The address of `origin`'s speed probe: `bytes` of noise, never from disk. */
  pingUrl: ({ origin, bytes = MEDIA_PROBE_BYTES }: PingUrlProps): string =>
    `${origin.url}/api/media-origins/ping?bytes=${bytes}`,

  /**
   * One subtitle track's cues. Embedded tracks come a window at a time
   * (see `subtitleWindows`); sidecar files come whole and ignore `window`.
   */
  getSubtitles: async ({
    id,
    trackId,
    window = 0,
    access = null,
  }: GetSubtitlesProps): Promise<SubtitleCue[]> =>
    parseWebVtt(
      await sendForText(
        mediaUrl({
          path: `/api/media/${id}/subtitles/${encodeURIComponent(trackId)}`,
          query: { window: String(window) },
          access,
        }),
      ),
    ),

  /**
   * The HLS master playlist for a converted stream. It mints a session
   * that holds `mode`, `audio` and `quality`, which are read as for
   * `streamUrl`.
   */
  hlsUrl: ({ id, mode, audio, quality, access, burn = null }: HlsUrlProps): string =>
    mediaUrl({
      path: HLS_PATHS.master.replace(`:${HLS_PARAMS.id}`, String(id)),
      query: {
        [HLS_PARAMS.mode]: mode,
        ...(audio == null ? {} : { [HLS_PARAMS.audio]: String(audio) }),
        ...(quality == null ? {} : { [HLS_PARAMS.quality]: quality }),
        ...(burn == null ? {} : { [HLS_PARAMS.burn]: burn }),
      },
      access,
    }),

  /**
   * A converted stream as fragmented MP4, starting at `start` seconds into
   * the file and stamped with file time plus `STREAM_TIME_SHIFT`. `audio`
   * picks the track by its `0:a:N` index; left out, the default plays.
   * `quality` sizes a transcode; left out, the server's settings do.
   */
  streamUrl: ({
    id,
    mode,
    start,
    audio,
    quality = null,
    access = null,
    burn = null,
  }: StreamUrlProps): string =>
    mediaUrl({
      path: `/api/media/${id}/stream`,
      query: {
        mode,
        start: String(Math.max(0, Math.round(start * 1000) / 1000)),
        ...(audio == null ? {} : { audio: String(audio) }),
        ...(quality == null ? {} : { quality }),
        ...(burn == null ? {} : { [HLS_PARAMS.burn]: burn }),
      },
      access,
    }),

  /** What the server is sending to whom right now. Admin only. */
  listLiveStreams: (): Promise<LiveStream[]> =>
    expect({ request: send({ path: '/api/streams' }), guard: isLiveStreamList }),

  /** Ends one stream's connections; the player may ask again. Admin only. */
  stopStream: async (id: string): Promise<void> => {
    await send({ path: `/api/streams/${encodeURIComponent(id)}/stop`, method: 'POST' })
  },
})
