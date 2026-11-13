import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  AUTH_CONFIG_STATES,
  type AuthConfig,
  type MediaMarkers,
  type MediaStreams,
  type MediaTicket,
  type MediaTracks,
  STREAM_PURPOSES,
  STREAM_TIME_SHIFT,
  TRANSCODINGS,
  isAudioContainer,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS, wholeNumber, CACHE_POLICIES } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AccessRechecks } from '@/auth/accessRechecks'
import { AccountTickets } from '@/auth/accountTickets'
import { AuthSessions } from '@/auth/authSessions'
import { AUTH_STATE } from '@/auth/effectiveAuth'
import { VIDEO_PLAN_KINDS, streamArgs } from '@/ffmpeg/args'
import { FFMPEG_SIGNALS, FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseStreams } from '@/ffmpeg/streams'
import { KeyframesService } from '@/hls/keyframesService'
import { MarkersService } from '@/markers/markersService'
import { RAVEN_CACHE_POLICIES, RAVEN_CONTENT_TYPES } from '@/http'
import { PrivateBy } from '@/lock/lockGuard'
import { QUERY_PARAMS, queryText } from '@/queryValues'
import { SettingsRepository } from '@/settings/settingsRepository'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { MEDIA_ROUTES } from '@/media/mediaRoutes'
import { MediaTickets } from '@/media/mediaTickets'
import { ConversionRequests } from '@/playback/conversionRequests'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { StreamSessions } from '@/streams/streamSessions'
import { RESPONSE_EVENTS, trackStream } from '@/streams/trackStream'
import { ROUTE_PARAMS } from '@/requestParts'
import { StrictlyLimited } from '@/rateLimits/rateTiers'
import { PRIVACIES } from '@/lock/lockService'

/**
 * What a player needs beyond the file itself: the tracks to choose from,
 * the intro, credits and chapters, subtitles as WebVTT, and a converted stream for files or tracks the
 * browser cannot play directly.
 */
@Controller(MEDIA_ROUTES)
@PrivateBy(PRIVACIES.media)
export class PlaybackController {
  constructor(
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(TracksService) private readonly tracks: TracksService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(MediaTickets) private readonly tickets: MediaTickets,
    @Inject(StreamSessions) private readonly streams: StreamSessions,
    @Inject(AUTH_STATE) private readonly auth: AuthConfig,
    @Inject(AccountTickets) private readonly accountTickets: AccountTickets,
    @Inject(AccessRechecks) private readonly rechecks: AccessRechecks,
    @Inject(AuthSessions) private readonly callers: AuthSessions,
    @Inject(KeyframesService) private readonly keyframes: KeyframesService,
    @Inject(MarkersService) private readonly markers: MarkersService,
    @Inject(ConversionRequests) private readonly conversions: ConversionRequests,
  ) {}

  /**
   * Stands in for the cookie on this video's media requests to another
   * origin. Not a media plane route: a ticket must never fetch another.
   * With accounts it is the account ticket the POST route mints, for a
   * Bearer caller only; without them, one signed with the media secret.
   */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @StrictlyLimited()
  @Get(':id/ticket')
  ticket(
    @Req() request: FastifyRequest,
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
  ): MediaTicket {
    this.index.requireFile(id)
    if (this.auth.state !== AUTH_CONFIG_STATES.off)
      return this.accountTickets.issue({ id, request })
    if (!this.tickets.isOn) {
      throw new ServiceUnavailableException('Set RAVEN_MEDIA_SECRET to hand out media tickets.')
    }
    return this.tickets.issue({ id })
  }

  @Get(':id/tracks')
  async listTracks(@Param(ROUTE_PARAMS.id, ParseIntPipe) id: number): Promise<MediaTracks> {
    const file = this.index.requireFile(id)
    const { tracks } = await this.tracks.tracksFor(file)
    this.warmKeyframes(file)
    return tracks
  }

  /** The intro, credits and chapters the player skips and rolls on by. */
  @Get(':id/markers')
  listMarkers(@Param(ROUTE_PARAMS.id, ParseIntPipe) id: number): Promise<MediaMarkers> {
    return this.markers.markersFor(this.index.requireFile(id))
  }

  /**
   * Every player reads the tracks before it plays, so the whole-file
   * keyframe probe an HLS remux waits for starts here, in the background,
   * and is usually done by the time the master playlist is asked for. A
   * probe already stored or running is not started again.
   */
  private warmKeyframes(file: MediaFile): void {
    if (this.settings.playback().transcoding === TRANSCODINGS.off) return
    this.keyframes.warm({ id: file.id, path: file.path })
  }

  /**
   * The file's picture and sound in detail, for the player's Playback info.
   * Probed on each ask rather than stored: only that panel asks, and the
   * index keeps what playback itself needs.
   */
  @Get(':id/streams')
  async listStreams(@Param(ROUTE_PARAMS.id, ParseIntPipe) id: number): Promise<MediaStreams> {
    return parseStreams(await this.ffmpeg.probeJson(this.index.requireFile(id).path))
  }

  /** WebVTT for one track; `window` picks the stretch of an embedded one. */
  @MediaPlane()
  @Get(':id/subtitles/:trackId')
  async subtitle(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Param(ROUTE_PARAMS.trackId) trackId: string,
    @Query(QUERY_PARAMS.window) window: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const asked = queryText({ value: window, name: QUERY_PARAMS.window })
    const part = asked == null ? 0 : wholeNumber(asked)
    if (part == null) throw new BadRequestException('window must be a whole number')
    const vtt = await this.subtitles.vtt({
      file: this.index.requireFile(id),
      trackId,
      window: part,
    })
    await reply
      .header(HEADERS.contentType, CONTENT_TYPES.vtt)
      .header(HEADERS.cacheControl, RAVEN_CACHE_POLICIES.privateFiveMinutes)
      .send(vtt)
  }

  /**
   * A converted stream: fragmented MP4 starting at `start` seconds, on the
   * file's clock plus `STREAM_TIME_SHIFT`. ffmpeg runs for as long as the
   * response is open and is killed the moment the client lets go, which
   * happens on every seek outside what is buffered.
   */
  @MediaPlane()
  @Get(':id/stream')
  async stream(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Query(QUERY_PARAMS.mode) mode: unknown,
    @Query(QUERY_PARAMS.start) start: unknown,
    @Query(QUERY_PARAMS.audio) audio: unknown,
    @Query(QUERY_PARAMS.quality) quality: unknown,
    @Query(QUERY_PARAMS.burn) burn: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const startText = queryText({ value: start, name: QUERY_PARAMS.start })
    const from = startText == null ? 0 : Number(startText)
    if (!Number.isFinite(from) || from < 0) {
      throw new BadRequestException('start must be a number of seconds')
    }
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
    const { file, sized } = conversion
    const child = this.ffmpeg.stream(
      streamArgs({
        input: file.path,
        start: from,
        audio: conversion.audio?.index ?? null,
        video: isAudioContainer(file.container)
          ? { kind: VIDEO_PLAN_KINDS.none }
          : conversion.video,
        streamShift: STREAM_TIME_SHIFT,
      }),
    )
    /*
     * The response closes when it finishes or when the client goes away;
     * killing an ffmpeg that already exited does nothing.
     */
    reply.raw.on(RESPONSE_EVENTS.close, () => child.kill(FFMPEG_SIGNALS.kill))
    trackStream({
      sessions: this.streams,
      ended: this.rechecks.ended({ request }),
      auth: this.callers,
      purpose: STREAM_PURPOSES.play,
      mediaId: id,
      mode: conversion.mode,
      quality: sized?.key ?? null,
      audio: conversion.audio?.index ?? null,
      from: 0,
      request,
      reply,
    })
    await reply
      .header(HEADERS.contentType, RAVEN_CONTENT_TYPES.mp4)
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send(child.stdout)
  }
}
