import { type MediaAccess, type TicketedOrigin, type Transport } from '@/apiClient/transport'
import {
  AUDIO_BITRATE_PARAM,
  type AudioBitrate,
  DEFAULT_DEVICE_DOWNLOAD_VARIANT,
  DEVICE_DOWNLOAD_PARAMS,
  DEVICE_DOWNLOAD_VARIANT_PARAM,
  type DeviceDownload,
  type DeviceDownloadVariant,
  HLS_PARAMS,
  type LiveStream,
  MEDIA_PROBE_BYTES,
  PING_BYTES_PARAM,
  type MediaOrigin,
  type MediaStreams,
  type MediaTicket,
  type MediaTracks,
  type StreamMode,
  type StreamQuality,
  type SubtitleCue,
} from '@/contract'
import { type MediaOriginsAnswer, readMediaOrigins } from '@/mediaOrigins'
import { toQueryString } from '@/query'
import { ROUTES, pathFor } from '@/routes'
import { parseWebVtt } from '@/subtitles'

type FileUrlProps = { id: number; access?: MediaAccess | null }

type GetDeviceDownloadProps = {
  mediaId: number
  /** Which copy to ask for; the picture's own, in an MP4, when none is named. */
  variant?: DeviceDownloadVariant
}

type DeviceDownloadFileUrlProps = FileUrlProps & Pick<GetDeviceDownloadProps, 'variant'>

/** The query that names a copy: nothing for the default, so a server from before `sdr` reads it the same. */
const variantQuery = (variant: DeviceDownloadVariant): Record<string, string> =>
  variant === DEFAULT_DEVICE_DOWNLOAD_VARIANT ? {} : { [DEVICE_DOWNLOAD_VARIANT_PARAM]: variant }

type TranscodeUrlProps = {
  mediaId: number
  kbps: AudioBitrate
  /** The origin it plays from and the ticket that opens it; null on this server's own, by its cookie. */
  access?: TicketedOrigin | null
}

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

type SidecarSubtitlesUrlProps = Omit<GetSubtitlesProps, 'window'>

type SubtitlesPathOfProps = Pick<GetSubtitlesProps, 'id' | 'trackId'>

/** The route one subtitle track's WebVTT is read from. */
const subtitlesPathOf = ({ id, trackId }: SubtitlesPathOfProps): string =>
  pathFor({ path: ROUTES.subtitles.path, params: { id, trackId } })

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
export const playbackCalls = ({ url, mediaUrl, sendForText, ask, tell }: Transport) => ({
  /** The original file, served with byte ranges: what a player loads for direct play. */
  fileUrl: ({ id, access = null }: FileUrlProps): string =>
    mediaUrl({ path: pathFor({ path: ROUTES.file.path, params: { id } }), query: {}, access }),

  /** A track converted to AAC at `kbps`, served with byte ranges like the original, from `access`'s origin as `fileUrl` is. */
  transcodeUrl: ({ mediaId, kbps, access = null }: TranscodeUrlProps): string =>
    mediaUrl({
      path: pathFor({ path: ROUTES.transcode.path, params: { id: mediaId } }),
      query: { [AUDIO_BITRATE_PARAM]: String(kbps) },
      access,
    }),

  /**
   * Where the server's MP4 copy of video `mediaId` stands, for a device whose player cannot
   * open the original, or `variant`'s SDR copy for a browser: asking starts the copy when
   * none is cached or running, and a failed copy is tried again on the ask after the one
   * that says so.
   */
  getDeviceDownload: ({
    mediaId,
    variant = DEFAULT_DEVICE_DOWNLOAD_VARIANT,
  }: GetDeviceDownloadProps): Promise<DeviceDownload> =>
    ask({
      route: ROUTES.getDeviceDownload,
      params: { [DEVICE_DOWNLOAD_PARAMS.id]: mediaId },
      query: variantQuery(variant),
    }),

  /** The server's finished MP4 copy of the video, with byte ranges, from `access`'s origin as `fileUrl` is. */
  deviceDownloadFileUrl: ({
    id,
    access = null,
    variant = DEFAULT_DEVICE_DOWNLOAD_VARIANT,
  }: DeviceDownloadFileUrlProps): string =>
    mediaUrl({
      path: pathFor({
        path: ROUTES.deviceDownloadFile.path,
        params: { [DEVICE_DOWNLOAD_PARAMS.id]: id },
      }),
      query: variantQuery(variant),
      access,
    }),

  /** The server's event stream: `ServerEvent`s, read with `parseServerEvent`. */
  eventsUrl: (): string => url(ROUTES.events.path),

  /** The audio and subtitle tracks a player can choose between. */
  getTracks: (id: number): Promise<MediaTracks> => ask({ route: ROUTES.getTracks, params: { id } }),

  /** The file's picture and sound in detail, probed afresh each time: profiles, bitrates, sample rates. */
  getStreams: (id: number): Promise<MediaStreams> =>
    ask({ route: ROUTES.getStreams, params: { id } }),

  /** The origins a browser may fetch media from directly, best first; none while tickets are off. */
  getMediaOrigins: async (): Promise<MediaOriginsAnswer> =>
    readMediaOrigins(await ask({ route: ROUTES.getMediaOrigins })),

  /** A short-lived ticket that stands in for the cookie on this video's media requests to another origin. */
  getMediaTicket: (id: number): Promise<MediaTicket> =>
    ask({ route: ROUTES.getMediaTicket, params: { id } }),

  /** The address of `origin`'s speed probe: `bytes` of noise, never from disk. */
  pingUrl: ({ origin, bytes = MEDIA_PROBE_BYTES }: PingUrlProps): string =>
    `${origin.url}${ROUTES.ping.path}?${toQueryString({ [PING_BYTES_PARAM]: String(bytes) })}`,

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
          path: subtitlesPathOf({ id, trackId }),
          query: { window: String(window) },
          access,
        }),
      ),
    ),

  /**
   * Where a sidecar subtitle file is, whole, as WebVTT, for a player that reads it itself
   * beside the file it plays.
   */
  sidecarSubtitlesUrl: ({ id, trackId, access = null }: SidecarSubtitlesUrlProps): string =>
    mediaUrl({ path: subtitlesPathOf({ id, trackId }), query: {}, access }),

  /**
   * The HLS master playlist for a converted stream. It mints a session
   * that holds `mode`, `audio` and `quality`, which are read as for
   * `streamUrl`.
   */
  hlsUrl: ({ id, mode, audio, quality, access, burn = null }: HlsUrlProps): string =>
    mediaUrl({
      path: pathFor({ path: ROUTES.hlsMaster.path, params: { [HLS_PARAMS.id]: id } }),
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
      path: pathFor({ path: ROUTES.stream.path, params: { id } }),
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
  listLiveStreams: (): Promise<LiveStream[]> => ask({ route: ROUTES.listLiveStreams }),

  /** Ends one stream's connections; the player may ask again. Admin only. */
  stopStream: async (id: string): Promise<void> => {
    await tell({ route: ROUTES.stopStream, params: { id } })
  },
})
