import { stat } from 'node:fs/promises'
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common'
import { type MediaStreams, type MediaTracks, STREAM_TIME_SHIFT, isStreamMode } from '@raven/core'
import { wholeNumber } from '@shared/server'
import type { FastifyReply } from 'fastify'
import { streamArgs } from '@/ffmpeg/args'
import { SOFTWARE } from '@/ffmpeg/encoder'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseStreams } from '@/ffmpeg/streams'
import { PrivateBy } from '@/lock/lockGuard'
import { SettingsRepository } from '@/settings/settingsRepository'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
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
  ) {}

  private fileOf(id: number): MediaFile {
    const file = this.index.fileOf(id)
    if (!file) throw new NotFoundException(`No media ${id}`)
    return file
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
      .header('content-type', 'text/vtt; charset=utf-8')
      .header('cache-control', 'private, max-age=300')
      .send(vtt)
  }

  /**
   * A converted stream: fragmented MP4 starting at `start` seconds, on the
   * file's clock plus `STREAM_TIME_SHIFT`. ffmpeg runs for as long as the
   * response is open and is killed the moment the client lets go, which
   * happens on every seek outside what is buffered.
   */
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
    if (playback.transcoding === 'off') {
      throw new ForbiddenException('Server conversion is off in Settings; only direct play is on.')
    }
    if (playback.transcoding === 'remuxOnly' && mode === 'transcode') {
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
      mode === 'transcode' && file.hdr && playback.tonemap && (await this.ffmpeg.canTonemap())
    const encoder = mode === 'transcode' ? await this.ffmpeg.videoEncoder() : SOFTWARE

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
      .header('content-type', 'video/mp4')
      .header('cache-control', 'no-store')
      .send(child.stdout)
  }
}
