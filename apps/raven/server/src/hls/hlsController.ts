import {
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type AudioTrack,
  HLS_COPY_AUDIO_CODECS,
  HLS_PARAMS,
  HLS_PATHS,
  HLS_SEGMENT_SECONDS,
  MEDIA_TICKET_PARAM,
  PLAYBACK_MODES,
  STREAM_TIME_SHIFT,
  type StreamMode,
  SUBTITLE_SOURCES,
  type SubtitleCue,
  type SubtitleTrack,
  audioCodecString,
  formatWebVtt,
  isHlsSessionId,
  mergeCues,
  parseWebVtt,
  subtitleWindowOf,
  toQueryString,
  videoCodecString,
} from '@raven/core'
import { CACHE_POLICIES, CONTENT_TYPES, HEADERS, wholeNumber } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AccessRechecks } from '@/auth/accessRechecks'
import { AuthSessions } from '@/auth/authSessions'
import { VIDEO_CODECS, hlsAudioCodec, transcodeBitrate } from '@/ffmpeg/args'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { isTransportStream, mediaClockOf, parseProbe } from '@/ffmpeg/probe'
import { type HlsSession, HlsSessions } from '@/hls/hlsSessions'
import { KeyframesService } from '@/hls/keyframesService'
import {
  masterPlaylist,
  mediaPlaylist,
  subtitlePlaylist,
  subtitleSegmentCount,
} from '@/hls/playlists'
import { type SegmentPlan, remuxPlan, transcodePlan } from '@/hls/segmentPlan'
import { RAVEN_CACHE_POLICIES, RAVEN_CONTENT_TYPES } from '@/http'
import { PrivateBy } from '@/lock/lockGuard'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { MediaPlane } from '@/media/mediaPlaneMark'
import {
  audioTrackOf,
  capHeight,
  refuseWhatSettingsTurnOff,
  sizeOnDisk,
  streamModeOf,
  streamSizeOf,
  videoEncodingOf,
} from '@/playback/conversion'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { SettingsRepository } from '@/settings/settingsRepository'
import { StreamSessions } from '@/streams/streamSessions'
import { RESPONSE_EVENTS, trackStream } from '@/streams/trackStream'

const MEDIA_ROUTES = 'api/media'

type HlsPath = (typeof HLS_PATHS)[keyof typeof HLS_PATHS]

/** An HLS path as this controller's route: what follows its `api/media` prefix. */
const routeOf = (path: HlsPath): string => path.slice(`/${MEDIA_ROUTES}/`.length)

/** The 90 kHz clock of MPEG-TS, which a WebVTT segment's `X-TIMESTAMP-MAP` ties its cues to. */
const MPEG_TS_HZ = 90_000

/** RFC 6381 names HLS players read differently from `MediaSource`, which `audioCodecString` serves. */
const HLS_AUDIO_STRINGS: Readonly<Record<string, string>> = { [HLS_COPY_AUDIO_CODECS.flac]: 'fLaC' }

/**
 * An HLS path with its placeholders filled in, absolute, and carrying the
 * request's ticket when it had one: a relative URI would not inherit it.
 */
const hlsUri = ({
  path,
  values,
  ticket,
}: {
  path: HlsPath
  values: Readonly<Record<string, string>>
  ticket: string | null
}): string => {
  const filled = path.replace(/:(\w+)/g, (placeholder, name: string) => {
    const value = values[name]
    return value == null ? placeholder : encodeURIComponent(value)
  })
  return ticket == null ? filled : `${filled}?${toQueryString({ [MEDIA_TICKET_PARAM]: ticket })}`
}

/** Every URI one session's playlists name. */
const urisOf = ({ session, ticket }: { session: HlsSession; ticket: string | null }) => {
  const of = (path: HlsPath, values: Readonly<Record<string, string>> = {}): string =>
    hlsUri({
      path,
      values: {
        [HLS_PARAMS.id]: String(session.mediaId),
        [HLS_PARAMS.session]: session.id,
        ...values,
      },
      ticket,
    })
  return {
    video: of(HLS_PATHS.video),
    init: of(HLS_PATHS.init),
    segment: (n: number) => of(HLS_PATHS.segment, { [HLS_PARAMS.n]: String(n) }),
    subtitles: (trackId: string) => of(HLS_PATHS.subtitles, { [HLS_PARAMS.trackId]: trackId }),
    subtitleSegment: ({ trackId, n }: { trackId: string; n: number }) =>
      of(HLS_PATHS.subtitleSegment, { [HLS_PARAMS.trackId]: trackId, [HLS_PARAMS.n]: String(n) }),
  }
}

/**
 * The stretch a subtitle segment covers, on the file's own clock: the
 * playlists start where the video's first segment does.
 */
const subtitleSpanOf = ({ plan, n }: { plan: SegmentPlan; n: number }) => {
  const from = (plan.boundaries[0] ?? 0) + n * HLS_SEGMENT_SECONDS
  return { from, to: from + HLS_SEGMENT_SECONDS }
}

/** How long the playlists run: from the first segment's start to the end. */
const playlistLength = (plan: SegmentPlan): number => plan.duration - (plan.boundaries[0] ?? 0)

/** The frame a transcode comes out at: no taller than `maxHeight`, the width kept in proportion and even. */
const scaledTo = ({
  width,
  height,
  maxHeight,
}: {
  width: number
  height: number
  maxHeight: number
}): { width: number; height: number } => {
  const scaled = Math.min(height, maxHeight)
  return { width: Math.round((width * scaled) / height / 2) * 2, height: scaled }
}

/** A transcode's video is 8-bit H.264 High; a remux's is the file's own. */
const videoStringOf = ({
  mode,
  file,
  bitDepth,
}: {
  mode: StreamMode
  file: MediaFile
  bitDepth: number | null
}): string | null => {
  if (mode === PLAYBACK_MODES.transcode) {
    return videoCodecString({ codec: VIDEO_CODECS.h264, bitDepth: null })
  }
  return file.videoCodec == null ? null : videoCodecString({ codec: file.videoCodec, bitDepth })
}

const audioStringOf = (track: AudioTrack): string | null => {
  const codec = hlsAudioCodec(track)
  return HLS_AUDIO_STRINGS[codec] ?? audioCodecString(codec)
}

/**
 * Converted media for players that take HLS rather than Media Source
 * Extensions: the native players on phones and TVs. The master playlist
 * opens a session, and the session's playlists, init and segments are
 * asked for by its id. Each route is on the media plane, so a ticket for
 * the video opens it, and every URI a playlist names carries that ticket.
 */
@Controller(MEDIA_ROUTES)
@PrivateBy('media')
export class HlsController {
  constructor(
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(TracksService) private readonly tracks: TracksService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(KeyframesService) private readonly keyframes: KeyframesService,
    @Inject(HlsSessions) private readonly sessions: HlsSessions,
    @Inject(StreamSessions) private readonly streams: StreamSessions,
    @Inject(AccessRechecks) private readonly rechecks: AccessRechecks,
    @Inject(AuthSessions) private readonly callers: AuthSessions,
  ) {}

  /**
   * Opens a session for one way of playing the file and lists its variant
   * and a rendition for each text subtitle track. Nothing is converted
   * until a segment is asked for. A remux whose keyframes lie too far
   * apart, or whose video HLS cannot carry, is a 409: transcode it instead.
   */
  @MediaPlane()
  @Get(routeOf(HLS_PATHS.master))
  async master(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Query(HLS_PARAMS.mode) mode: string | undefined,
    @Query(HLS_PARAMS.audio) audio: string | undefined,
    @Query(HLS_PARAMS.quality) quality: string | undefined,
    @Query(MEDIA_TICKET_PARAM) ticket: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const streamMode = streamModeOf(mode)
    const playback = this.settings.playback()
    refuseWhatSettingsTurnOff({ playback, mode: streamMode })
    const sized = streamSizeOf({ quality, mode: streamMode })
    const file = this.fileOf(id)
    const bytes = await sizeOnDisk(file)
    const { tracks } = await this.tracks.tracksFor(file)
    const audioTrack = audioTrackOf({ tracks, audio })

    const output = await this.ffmpeg.probeJson(file.path)
    const probe = parseProbe(output)
    const clock = mediaClockOf(output)
    const end = clock.end ?? (file.duration == null ? null : clock.start + file.duration)
    if (probe?.width == null || probe.height == null || end == null) {
      throw new UnprocessableEntityException('This file has no picture of a known length to cut')
    }
    const videoString = videoStringOf({ mode: streamMode, file, bitDepth: probe.videoBitDepth })
    if (videoString == null) {
      throw new ConflictException("HLS can't carry this video as it is; transcode it")
    }
    const plan =
      streamMode === PLAYBACK_MODES.remux
        ? remuxPlan({
            keyframes: await this.keyframes.of({ id, path: file.path }),
            duration: end,
          })
        : transcodePlan({ start: clock.videoStart, duration: end, frameRate: clock.frameRate })
    if (!plan) {
      throw new ConflictException('Keyframes lie too far apart in this file to remux; transcode it')
    }

    const seekKeyframes =
      streamMode === PLAYBACK_MODES.transcode && isTransportStream(output)
        ? await this.keyframes.of({ id, path: file.path })
        : null
    const { tonemap, encoder } = await videoEncodingOf({
      ffmpeg: this.ffmpeg,
      file,
      mode: streamMode,
      playback,
    })
    const maxHeight = capHeight({ size: sized?.size ?? null, maxHeight: playback.maxHeight })
    const bitrate = sized?.size.bitrate ?? null
    const session = this.sessions.mint({
      mediaId: id,
      mode: streamMode,
      audio: audioTrack,
      quality: sized?.key ?? null,
      plan,
      startTime: clock.start,
      encoding: {
        input: file.path,
        videoCodec: file.videoCodec,
        encoder,
        maxHeight,
        quality: playback.quality,
        bitrate,
        tonemap,
        frameRate: clock.frameRate,
        seekKeyframes,
      },
    })

    const uris = urisOf({ session, ticket: ticket ?? null })
    const audioString = audioTrack ? audioStringOf(audioTrack) : null
    const frame = { width: probe.width, height: probe.height }
    const playlist = masterPlaylist({
      mode: streamMode,
      variantUri: uris.video,
      subtitles: tracks.subtitles.map((track) => ({ track, uri: uris.subtitles(track.id) })),
      codecs: [videoString, ...(audioString == null ? [] : [audioString])].join(','),
      resolution: streamMode === PLAYBACK_MODES.remux ? frame : scaledTo({ ...frame, maxHeight }),
      bandwidth:
        streamMode === PLAYBACK_MODES.remux
          ? (probe.bitrate ?? Math.round((bytes * 8) / playlistLength(plan)))
          : transcodeBitrate({ quality: playback.quality, bitrate }),
    })
    await this.sendPlaylist({ reply, playlist })
  }

  /** Every segment of the session's plan, behind its init. */
  @MediaPlane()
  @Get(routeOf(HLS_PATHS.video))
  async video(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Query(MEDIA_TICKET_PARAM) ticket: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = this.sessionOf({ id, session })
    const uris = urisOf({ session: opened, ticket: ticket ?? null })
    await this.sendPlaylist({
      reply,
      playlist: mediaPlaylist({ plan: opened.plan, initUri: uris.init, segmentUri: uris.segment }),
    })
  }

  @MediaPlane()
  @Get(routeOf(HLS_PATHS.init))
  async init(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = this.sessionOf({ id, session })
    await this.sendMedia({
      request,
      reply,
      session: opened,
      type: RAVEN_CONTENT_TYPES.mp4,
      bytes: (signal) => this.sessions.init({ session: opened.id, signal }),
    })
  }

  @MediaPlane()
  @Get(routeOf(HLS_PATHS.segment))
  async segment(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Param(HLS_PARAMS.n) n: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = this.sessionOf({ id, session })
    const number = wholeNumber(n)
    if (number == null) throw new NotFoundException(`No segment ${n} in this stream`)
    await this.sendMedia({
      request,
      reply,
      session: opened,
      type: RAVEN_CONTENT_TYPES.segment,
      bytes: (signal) => this.sessions.segment({ session: opened.id, n: number, signal }),
    })
  }

  /** A text subtitle track as six-second WebVTT segments, timed as the video playlist is. */
  @MediaPlane()
  @Get(routeOf(HLS_PATHS.subtitles))
  async subtitlePlaylist(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Param(HLS_PARAMS.trackId) trackId: string,
    @Query(MEDIA_TICKET_PARAM) ticket: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = this.sessionOf({ id, session })
    await this.textTrackOf({ file: this.fileOf(id), trackId })
    const uris = urisOf({ session: opened, ticket: ticket ?? null })
    await this.sendPlaylist({
      reply,
      playlist: subtitlePlaylist({
        duration: playlistLength(opened.plan),
        segmentUri: (n) => uris.subtitleSegment({ trackId, n }),
      }),
    })
  }

  /**
   * The cues showing in subtitle segment `n`, cut from the track's WebVTT:
   * the whole sidecar, or the windows of an embedded track the segment
   * falls in. Those are timed from the file's start, so each cue is moved
   * onto the file's own clock, which the video keeps.
   */
  @MediaPlane()
  @Get(routeOf(HLS_PATHS.subtitleSegment))
  async subtitleSegment(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Param(HLS_PARAMS.trackId) trackId: string,
    @Param(HLS_PARAMS.n) n: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = this.sessionOf({ id, session })
    const file = this.fileOf(id)
    const track = await this.textTrackOf({ file, trackId })
    const number = wholeNumber(n)
    if (number == null || number >= subtitleSegmentCount(playlistLength(opened.plan))) {
      throw new NotFoundException(`No subtitle segment ${n} in this stream`)
    }
    const { from, to } = subtitleSpanOf({ plan: opened.plan, n: number })
    const first = subtitleWindowOf(from - opened.startTime)
    const last = subtitleWindowOf(to - opened.startTime)
    const windows =
      track.source === SUBTITLE_SOURCES.external
        ? [0]
        : Array.from({ length: last - first + 1 }, (_, k) => first + k)
    const texts = await Promise.all(
      windows.map((window) => this.subtitles.vtt({ file, trackId, window })),
    )
    const cues = texts
      .map(parseWebVtt)
      .reduce<SubtitleCue[]>((existing, incoming) => mergeCues({ existing, incoming }), [])
      .map((cue) => ({
        start: cue.start + opened.startTime,
        end: cue.end + opened.startTime,
        text: cue.text,
      }))
      .filter((cue) => cue.end > from && cue.start < to)
    await reply
      .header(HEADERS.contentType, CONTENT_TYPES.vtt)
      .header(HEADERS.cacheControl, RAVEN_CACHE_POLICIES.privateFiveMinutes)
      .send(
        formatWebVtt({
          cues,
          timestampMap: { mpegts: STREAM_TIME_SHIFT * MPEG_TS_HZ, local: 0 },
        }),
      )
  }

  private fileOf(id: number): MediaFile {
    const file = this.index.fileOf(id)
    if (!file) throw new NotFoundException(`No media ${id}`)
    return file
  }

  private sessionOf({ id, session }: { id: number; session: string }): HlsSession {
    const opened = isHlsSessionId(session) ? this.sessions.get({ mediaId: id, session }) : null
    if (!opened) throw new NotFoundException('No such stream session; open the stream again')
    return opened
  }

  /** A track a rendition can show: a picture track has none. */
  private async textTrackOf({
    file,
    trackId,
  }: {
    file: MediaFile
    trackId: string
  }): Promise<SubtitleTrack> {
    const { tracks } = await this.tracks.tracksFor(file)
    const track = tracks.subtitles.find((candidate) => candidate.id === trackId)
    if (!track?.supported) throw new NotFoundException(`No text subtitle track ${trackId}`)
    return track
  }

  private async sendPlaylist({
    reply,
    playlist,
  }: {
    reply: FastifyReply
    playlist: string
  }): Promise<void> {
    // Each URI in it carries a ticket, and the session behind it ends.
    await reply
      .header(HEADERS.contentType, CONTENT_TYPES.m3u8)
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send(playlist)
  }

  /**
   * Sends an init or a segment once the session has it. A request whose
   * client goes away while it waits lets go, so it starts no run, and
   * there is nobody left to answer.
   */
  private async sendMedia({
    request,
    reply,
    session,
    type,
    bytes,
  }: {
    request: FastifyRequest
    reply: FastifyReply
    session: HlsSession
    type: (typeof RAVEN_CONTENT_TYPES)[keyof typeof RAVEN_CONTENT_TYPES]
    bytes: (signal: AbortSignal) => Promise<Uint8Array>
  }): Promise<void> {
    const gone = new AbortController()
    reply.raw.on(RESPONSE_EVENTS.close, () => gone.abort())
    const body = await bytes(gone.signal).catch((error: unknown) => {
      if (gone.signal.aborted) return null
      throw error
    })
    if (body == null) return
    trackStream({
      sessions: this.streams,
      rechecks: this.rechecks,
      auth: this.callers,
      mediaId: session.mediaId,
      mode: session.mode,
      quality: session.quality,
      audio: session.audio,
      request,
      reply,
    })
    await reply
      .header(HEADERS.contentType, type)
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send(Buffer.from(body.buffer, body.byteOffset, body.byteLength))
  }
}
