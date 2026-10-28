import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
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
  type MediaStreams,
  type MediaTicket,
  type MediaTracks,
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
import { streamArgs } from '@/ffmpeg/args'
import { FFMPEG_SIGNALS, FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseStreams } from '@/ffmpeg/streams'
import { KeyframesService } from '@/hls/keyframesService'
import { RAVEN_CACHE_POLICIES, RAVEN_CONTENT_TYPES } from '@/http'
import { PrivateBy } from '@/lock/lockGuard'
import { SettingsRepository } from '@/settings/settingsRepository'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { MediaTickets } from '@/media/mediaTickets'
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
import { StreamSessions } from '@/streams/streamSessions'
import { RESPONSE_EVENTS, trackStream } from '@/streams/trackStream'
import { ROUTE_PARAMS } from '@/requestParts'

/**
 * What a player needs beyond the file itself: the tracks to choose from,
 * subtitles as WebVTT, and a converted stream for files or tracks the
 * browser cannot play directly.
 */
@Controller('api/media')
@PrivateBy('media')
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
  ) {}

  private fileOf(id: number): MediaFile {
    const file = this.index.fileOf(id)
    if (!file) throw new NotFoundException(`No media ${id}`)
    return file
  }

  /**
   * Stands in for the cookie on this video's media requests to another
   * origin. Not a media plane route: a ticket must never fetch another.
   * With accounts it is the account ticket the POST route mints, for a
   * Bearer caller only; without them, one signed with the media secret.
   */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(':id/ticket')
  ticket(
    @Req() request: FastifyRequest,
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
  ): MediaTicket {
    this.fileOf(id)
    if (this.auth.state !== AUTH_CONFIG_STATES.off)
      return this.accountTickets.issue({ id, request })
    if (!this.tickets.isOn) {
      throw new ServiceUnavailableException('Set RAVEN_MEDIA_SECRET to hand out media tickets.')
    }
    return this.tickets.issue({ id })
  }

  @Get(':id/tracks')
  async listTracks(@Param('id', ParseIntPipe) id: number): Promise<MediaTracks> {
    const file = this.fileOf(id)
    const { tracks } = await this.tracks.tracksFor(file)
    this.warmKeyframes(file)
    return tracks
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
  async listStreams(@Param('id', ParseIntPipe) id: number): Promise<MediaStreams> {
    return parseStreams(await this.ffmpeg.probeJson(this.fileOf(id).path))
  }

  /** WebVTT for one track; `window` picks the stretch of an embedded one. */
  @MediaPlane()
  @Get(':id/subtitles/:trackId')
  async subtitle(
    @Param('id', ParseIntPipe) id: number,
    @Param('trackId') trackId: string,
    @Query('window') window: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const part = window == null ? 0 : wholeNumber(window)
    if (part == null) throw new BadRequestException('window must be a whole number')
    const vtt = await this.subtitles.vtt({ file: this.fileOf(id), trackId, window: part })
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
    @Param('id', ParseIntPipe) id: number,
    @Query('mode') mode: string | undefined,
    @Query('start') start: string | undefined,
    @Query('audio') audio: string | undefined,
    @Query('quality') quality: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const streamMode = streamModeOf(mode)
    const playback = this.settings.playback()
    refuseWhatSettingsTurnOff({ playback, mode: streamMode })
    const sized = streamSizeOf({ quality, mode: streamMode })
    const size = sized?.size ?? null
    const from = start == null ? 0 : Number(start)
    if (!Number.isFinite(from) || from < 0) {
      throw new BadRequestException('start must be a number of seconds')
    }
    const file = this.fileOf(id)
    await sizeOnDisk(file)

    const { tracks } = await this.tracks.tracksFor(file)
    const chosen = audioTrackOf({ tracks, audio })
    const { tonemap, encoder } = await videoEncodingOf({
      ffmpeg: this.ffmpeg,
      file,
      mode: streamMode,
      playback,
    })

    const child = this.ffmpeg.stream(
      streamArgs({
        input: file.path,
        start: from,
        mode: streamMode,
        audio: chosen?.index ?? null,
        audioOnly: isAudioContainer(file.container),
        videoCodec: file.videoCodec,
        tonemap,
        streamShift: STREAM_TIME_SHIFT,
        encoder,
        maxHeight: capHeight({ size, maxHeight: playback.maxHeight }),
        quality: playback.quality,
        bitrate: size?.bitrate ?? null,
      }),
    )
    // The response closes when it finishes or when the client goes away;
    // killing an ffmpeg that already exited does nothing.
    reply.raw.on(RESPONSE_EVENTS.close, () => child.kill(FFMPEG_SIGNALS.kill))
    trackStream({
      sessions: this.streams,
      ended: this.rechecks.ended({ request }),
      auth: this.callers,
      mediaId: id,
      mode: streamMode,
      quality: sized?.key ?? null,
      audio: chosen?.index ?? null,
      request,
      reply,
    })
    await reply
      .header(HEADERS.contentType, RAVEN_CONTENT_TYPES.mp4)
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send(child.stdout)
  }
}
