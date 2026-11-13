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
  AUTH_REFUSALS,
  HLS_PARAMS,
  HLS_PATHS,
  MEDIA_TICKET_PARAM,
  PLAYBACK_MODES,
  STREAM_PURPOSES,
  VIDEO_RANGES,
  type StreamMode,
  type SubtitleTrack,
  isHlsSessionId,
  isString,
} from '@raven/core'
import { CACHE_POLICIES, CONTENT_TYPES, HEADERS, wholeNumber } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AccessRechecks } from '@/auth/accessRechecks'
import { OpenedByPass, PASS_KINDS } from '@/auth/accountPasses'
import { authFailure } from '@/auth/authFailure'
import { AuthSessions } from '@/auth/authSessions'
import { TicketAccesses } from '@/auth/ticketAccesses'
import { PICTURE_MODES, VIDEO_PLAN_KINDS } from '@/ffmpeg/args'
import { type MediaClock, isTransportStream, mediaClockOf, parseProbe } from '@/ffmpeg/probe'
import { parseStreams } from '@/ffmpeg/streams'
import { sessionUris } from '@/hls/hlsUris'
import { type HlsSession, HlsSessions, noSuchSession } from '@/hls/hlsSessions'
import { KeyframesService } from '@/hls/keyframesService'
import {
  masterPlaylist,
  mediaPlaylist,
  subtitlePlaylist,
  subtitleSegmentCount,
} from '@/hls/playlists'
import { type SegmentPlan, playlistLength, remuxPlan, transcodePlan } from '@/hls/segmentPlan'
import { subtitleSegmentVtt, subtitleSpanOf, subtitleWindowsOf } from '@/hls/subtitleSegments'
import { variantOf, videoStringOf } from '@/hls/variant'
import { RAVEN_CACHE_POLICIES, RAVEN_CONTENT_TYPES } from '@/http'
import { PrivateBy } from '@/lock/lockGuard'
import { PRIVACIES } from '@/lock/lockService'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { MEDIA_ROUTES, routeOf } from '@/media/mediaRoutes'
import { ConversionRequests } from '@/playback/conversionRequests'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { QUERY_PARAMS, queryText } from '@/queryValues'
import { StreamSessions } from '@/streams/streamSessions'
import { RESPONSE_EVENTS, trackStream } from '@/streams/trackStream'

/** `?t=` as one value may arrive: absent, or a string. Repeated, it is an array. */
const isTicketQuery = (value: unknown): value is string | undefined =>
  value === undefined || isString(value)

/** `?t=` at the boundary: a repeated one is refused as a ticket that opens nothing is. */
const ticketIn = (value: unknown): string | undefined => {
  if (!isTicketQuery(value)) throw authFailure(AUTH_REFUSALS.signedOut)
  return value
}

type HlsControllerKeyForProps = {
  session: Pick<HlsSession, 'capability'>
  ticket: string | undefined
}

/** What every URI a session's playlist names carries: its capability, else the request's ticket. */
const keyFor = ({ session, ticket }: HlsControllerKeyForProps): string | null =>
  session.capability ?? ticket ?? null

type HlsControllerPlanOfProps = {
  mode: StreamMode
  file: MediaFile
  clock: MediaClock
  end: number
}

type HlsControllerSessionOfProps = {
  id: number
  session: string
  key: string | undefined
}

type HlsControllerTextTrackOfProps = {
  file: MediaFile
  trackId: string
}

type HlsControllerSendPlaylistProps = {
  reply: FastifyReply
  playlist: string
}

type HlsControllerSendMediaProps = {
  request: FastifyRequest
  reply: FastifyReply
  session: HlsSession
  type: (typeof RAVEN_CONTENT_TYPES)[keyof typeof RAVEN_CONTENT_TYPES]
  bytes: (signal: AbortSignal) => Promise<Uint8Array>
}

/**
 * Converted media for players that take HLS rather than Media Source
 * Extensions: the native players on phones and TVs. The master playlist
 * opens a session, and the session's playlists, init and segments are
 * asked for by its id. Each route is on the media plane, so a ticket for
 * the video opens it. Every URI a playlist names carries the legacy ticket
 * the master was opened with, or, when an account ticket opened it, the
 * session's own capability, which then alone opens the session's routes.
 */
@Controller(MEDIA_ROUTES)
@PrivateBy(PRIVACIES.media)
export class HlsController {
  constructor(
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(TracksService) private readonly tracks: TracksService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
    @Inject(KeyframesService) private readonly keyframes: KeyframesService,
    @Inject(HlsSessions) private readonly sessions: HlsSessions,
    @Inject(StreamSessions) private readonly streams: StreamSessions,
    @Inject(AccessRechecks) private readonly rechecks: AccessRechecks,
    @Inject(TicketAccesses) private readonly accesses: Pick<TicketAccesses, 'accessOf'>,
    @Inject(AuthSessions) private readonly callers: AuthSessions,
    @Inject(ConversionRequests) private readonly conversions: ConversionRequests,
  ) {}

  /**
   * Opens a session for one way of playing the file and lists its variant
   * and a rendition for each text subtitle track. Nothing is converted
   * until a segment is asked for. A remux whose keyframes lie too far
   * apart, or whose video HLS cannot carry, is a 409: transcode it instead.
   * A transcode may burn a picture subtitle into the picture (`burn`), the
   * one way a player shows Blu-ray PGS or VobSub over a stream.
   */
  @MediaPlane()
  @Get(routeOf(HLS_PATHS.master))
  async master(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Query(QUERY_PARAMS.mode) mode: unknown,
    @Query(QUERY_PARAMS.audio) audio: unknown,
    @Query(QUERY_PARAMS.quality) quality: unknown,
    @Query(QUERY_PARAMS.burn) burn: unknown,
    @Query(MEDIA_TICKET_PARAM) query: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ticket = ticketIn(query)
    const conversion = await this.conversions.open({
      id,
      ask: {
        mode: queryText({ value: mode, name: QUERY_PARAMS.mode }),
        audio: queryText({ value: audio, name: QUERY_PARAMS.audio }),
        quality: queryText({ value: quality, name: QUERY_PARAMS.quality }),
        burn: queryText({ value: burn, name: QUERY_PARAMS.burn }),
      },
      request,
    })
    const { mode: streamMode, file, video } = conversion
    const output = await conversion.probe()
    const probe = parseProbe(output)
    const clock = mediaClockOf(output)
    const end = clock.end ?? (file.duration == null ? null : clock.start + file.duration)
    if (probe === null || probe.width == null || probe.height == null || end == null) {
      throw new UnprocessableEntityException('This file has no picture of a known length to cut')
    }
    const picture = parseStreams(output).video
    const videoString = videoStringOf({
      mode: streamMode,
      videoCodec: file.videoCodec,
      bitDepth: probe.videoBitDepth,
      dolbyVision: video.kind === VIDEO_PLAN_KINDS.copy ? video.dolbyVision : null,
    })
    if (videoString == null) {
      throw new ConflictException("HLS can't carry this video as it is; transcode it")
    }
    const plan = await this.planOf({ mode: streamMode, file, clock, end })
    const keyframesFor =
      streamMode === PLAYBACK_MODES.transcode && isTransportStream(output)
        ? this.transportKeyframes(file)
        : null
    const session = this.sessions.mint({
      mediaId: id,
      asked: conversion.sized?.key ?? null,
      source: {
        input: file.path,
        plan,
        startTime: clock.start,
        frameRate: clock.frameRate,
        audio: conversion.audio,
        video,
      },
      keyframesFor,
      // Only an account ticket's session has a pass; any other caller's needs no capability.
      access: this.accesses.accessOf({ request, mediaId: id }),
    })

    const uris = sessionUris({ session, key: keyFor({ session, ticket }) })
    const playlist = masterPlaylist({
      mode: streamMode,
      videoRange: picture?.range ?? VIDEO_RANGES.sdr,
      variantUri: uris.video,
      subtitles: conversion.tracks.subtitles.map((track) => ({
        track,
        uri: uris.subtitles(track.id),
      })),
      ...variantOf({
        mode: streamMode,
        videoString,
        audio: conversion.audio,
        frame: { width: probe.width, height: probe.height },
        plan,
        fileBitrate: probe.bitrate,
        bytes: conversion.bytes,
        maxHeight: conversion.maxHeight,
        quality: conversion.playback.quality,
        bitrate: conversion.bitrate,
      }),
    })
    await this.sendPlaylist({ reply, playlist })
  }

  /** Every segment of the session's plan, behind its init. */
  @MediaPlane()
  @OpenedByPass(PASS_KINDS.capability)
  @Get(routeOf(HLS_PATHS.video))
  async video(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Query(MEDIA_TICKET_PARAM) query: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ticket = ticketIn(query)
    const opened = this.sessionOf({ id, session, key: ticket })
    const uris = sessionUris({ session: opened, key: keyFor({ session: opened, ticket }) })
    await this.sendPlaylist({
      reply,
      playlist: mediaPlaylist({ plan: opened.plan, initUri: uris.init, segmentUri: uris.segment }),
    })
  }

  @MediaPlane()
  @OpenedByPass(PASS_KINDS.capability)
  @Get(routeOf(HLS_PATHS.init))
  async init(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Query(MEDIA_TICKET_PARAM) query: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = this.sessionOf({ id, session, key: ticketIn(query) })
    await this.sendMedia({
      request,
      reply,
      session: opened,
      type: RAVEN_CONTENT_TYPES.mp4,
      bytes: (signal) => this.sessions.init({ session: opened.id, signal }),
    })
  }

  @MediaPlane()
  @OpenedByPass(PASS_KINDS.capability)
  @Get(routeOf(HLS_PATHS.segment))
  async segment(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Param(HLS_PARAMS.n) n: string,
    @Query(MEDIA_TICKET_PARAM) query: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = this.sessionOf({ id, session, key: ticketIn(query) })
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
  @OpenedByPass(PASS_KINDS.capability)
  @Get(routeOf(HLS_PATHS.subtitles))
  async subtitlePlaylist(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Param(HLS_PARAMS.trackId) trackId: string,
    @Query(MEDIA_TICKET_PARAM) query: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ticket = ticketIn(query)
    const opened = this.sessionOf({ id, session, key: ticket })
    await this.textTrackOf({ file: this.index.requireFile(id), trackId })
    const uris = sessionUris({ session: opened, key: keyFor({ session: opened, ticket }) })
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
  @OpenedByPass(PASS_KINDS.capability)
  @Get(routeOf(HLS_PATHS.subtitleSegment))
  async subtitleSegment(
    @Param(HLS_PARAMS.id, ParseIntPipe) id: number,
    @Param(HLS_PARAMS.session) session: string,
    @Param(HLS_PARAMS.trackId) trackId: string,
    @Param(HLS_PARAMS.n) n: string,
    @Query(MEDIA_TICKET_PARAM) query: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = this.sessionOf({ id, session, key: ticketIn(query) })
    const file = this.index.requireFile(id)
    const track = await this.textTrackOf({ file, trackId })
    const number = wholeNumber(n)
    if (number == null || number >= subtitleSegmentCount(playlistLength(opened.plan))) {
      throw new NotFoundException(`No subtitle segment ${n} in this stream`)
    }
    const span = subtitleSpanOf({ plan: opened.plan, n: number })
    const texts = await Promise.all(
      subtitleWindowsOf({ track, span, startTime: opened.startTime }).map((window) =>
        this.subtitles.vtt({ file, trackId, window }),
      ),
    )
    await reply
      .header(HEADERS.contentType, CONTENT_TYPES.vtt)
      .header(HEADERS.cacheControl, RAVEN_CACHE_POLICIES.privateFiveMinutes)
      .send(subtitleSegmentVtt({ texts, span, startTime: opened.startTime }))
  }

  /** The segments the session cuts: a remux's at its keyframes, a transcode's on its frames. */
  private async planOf({ mode, file, clock, end }: HlsControllerPlanOfProps): Promise<SegmentPlan> {
    const plan =
      mode === PLAYBACK_MODES.remux
        ? remuxPlan({
            keyframes: await this.keyframes.of({ id: file.id, path: file.path }),
            duration: end,
          })
        : transcodePlan({ start: clock.videoStart, duration: end, frameRate: clock.frameRate })
    if (!plan) {
      throw new ConflictException('Keyframes lie too far apart in this file to remux; transcode it')
    }
    return plan
  }

  /**
   * How a transport stream's restarts find its keyframes. The run from 0
   * needs none, so the playlist never waits for the whole-file probe: it
   * starts here in the background, and a restart uses what is stored by
   * then.
   */
  private transportKeyframes(file: MediaFile): () => readonly number[] | null {
    this.keyframes.warm({ id: file.id, path: file.path })
    return () => this.index.storedKeyframes(file.id)
  }

  /** The session `key` opens: any key for one without a capability, only its capability for one with. */
  private sessionOf({ id, session, key }: HlsControllerSessionOfProps): HlsSession {
    const opened = isHlsSessionId(session) ? this.sessions.get({ mediaId: id, session, key }) : null
    if (!opened) throw noSuchSession()
    return opened
  }

  /** A track a rendition can show: a picture track has none. */
  private async textTrackOf({
    file,
    trackId,
  }: HlsControllerTextTrackOfProps): Promise<SubtitleTrack> {
    const { tracks } = await this.tracks.tracksFor(file)
    const track = tracks.subtitles.find((candidate) => candidate.id === trackId)
    if (track === undefined || !track.supported) {
      throw new NotFoundException(`No text subtitle track ${trackId}`)
    }
    return track
  }

  private async sendPlaylist({ reply, playlist }: HlsControllerSendPlaylistProps): Promise<void> {
    // Each URI in it carries a ticket or a capability, and the session behind it ends.
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
  }: HlsControllerSendMediaProps): Promise<void> {
    const gone = new AbortController()
    reply.raw.on(RESPONSE_EVENTS.close, () => gone.abort())
    const body = await bytes(gone.signal).catch((error: unknown) => {
      if (gone.signal.aborted) return null
      throw error
    })
    if (body == null) return
    trackStream({
      sessions: this.streams,
      ended: this.rechecks.ended({ request }),
      auth: this.callers,
      purpose: STREAM_PURPOSES.play,
      mediaId: session.mediaId,
      mode: PICTURE_MODES[session.video.kind],
      quality: session.asked,
      audio: session.audio?.index ?? null,
      from: 0,
      request,
      reply,
    })
    await reply
      .header(HEADERS.contentType, type)
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send(Buffer.from(body.buffer, body.byteOffset, body.byteLength))
  }
}
