import { stat } from 'node:fs/promises'
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type MediaStreams,
  type MediaTicket,
  type MediaTracks,
  PLAYBACK_MODES,
  STREAM_TIME_SHIFT,
  TRANSCODINGS,
  isStreamMode,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS, wholeNumber, CACHE_POLICIES } from '@shared/server'
import type { FastifyReply } from 'fastify'
import { streamArgs } from '@/ffmpeg/args'
import { SOFTWARE } from '@/ffmpeg/encoder'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseStreams } from '@/ffmpeg/streams'
import { RAVEN_CACHE_POLICIES, RAVEN_CONTENT_TYPES } from '@/http'
import { PrivateBy } from '@/lock/lockGuard'
import { SettingsRepository } from '@/settings/settingsRepository'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { MediaTickets } from '@/media/mediaTickets'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'

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
  ) {}

  private fileOf(id: number): MediaFile {
    const file = this.index.fileOf(id)
    if (!file) throw new NotFoundException(`No media ${id}`)
    return file
  }

  /**
   * Stands in for the cookie on this video's media requests to another
   * origin. Not a media plane route: a ticket must never fetch another.
   */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(':id/ticket')
  ticket(@Param('id', ParseIntPipe) id: number): MediaTicket {
    this.fileOf(id)
    if (!this.tickets.isOn) {
      throw new ServiceUnavailableException('Set RAVEN_MEDIA_SECRET to hand out media tickets.')
    }
    return this.tickets.issue({ id })
  }

  @Get(':id/tracks')
  async listTracks(@Param('id', ParseIntPipe) id: number): Promise<MediaTracks> {
    return (await this.tracks.tracksFor(this.fileOf(id))).tracks
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
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isStreamMode(mode)) throw new BadRequestException('mode must be remux or transcode')
    const playback = this.settings.playback()
    if (playback.transcoding === TRANSCODINGS.off) {
      throw new ForbiddenException('Server conversion is off in Settings; only direct play is on.')
    }
    if (playback.transcoding === TRANSCODINGS.remuxOnly && mode === PLAYBACK_MODES.transcode) {
      throw new ForbiddenException('Transcoding is off in Settings; only remuxing is on.')
    }
    const from = start == null ? 0 : Number(start)
    if (!Number.isFinite(from) || from < 0) {
      throw new BadRequestException('start must be a number of seconds')
    }
    const file = this.fileOf(id)
    const info = await stat(file.path).catch(() => null)
    if (!info?.isFile()) throw new NotFoundException('The file is no longer on disk')

    const { tracks } = await this.tracks.tracksFor(file)
    const chosen = audio == null ? tracks.defaultAudio : wholeNumber(audio)
    if (
      audio != null &&
      (chosen == null || !tracks.audio.some((track) => track.index === chosen))
    ) {
      throw new BadRequestException(`No audio track ${audio}`)
    }
    const tonemap =
      mode === PLAYBACK_MODES.transcode &&
      file.hdr &&
      playback.tonemap &&
      (await this.ffmpeg.canTonemap())
    const encoder = mode === PLAYBACK_MODES.transcode ? await this.ffmpeg.videoEncoder() : SOFTWARE

    const child = this.ffmpeg.stream(
      streamArgs({
        input: file.path,
        start: from,
        mode,
        audio: chosen,
        videoCodec: file.videoCodec,
        tonemap,
        streamShift: STREAM_TIME_SHIFT,
        encoder,
        maxHeight: playback.maxHeight,
        quality: playback.quality,
      }),
    )
    // The response closes when it finishes or when the client goes away;
    // killing an ffmpeg that already exited does nothing.
    reply.raw.on('close', () => child.kill('SIGKILL'))
    await reply
      .header(HEADERS.contentType, RAVEN_CONTENT_TYPES.mp4)
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send(child.stdout)
  }
}
