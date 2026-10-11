import { stat } from 'node:fs/promises'
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common'
import { type MediaTracks, STREAM_TIME_SHIFT, type StreamMode } from '@raven/core'
import type { FastifyReply } from 'fastify'
import { streamArgs } from '@/ffmpeg/args'
import { SOFTWARE } from '@/ffmpeg/encoder'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { type MediaRecord, MediaRepository } from '@/media/mediaRepository'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'

const STREAM_MODES: readonly StreamMode[] = ['remux', 'transcode']

const isStreamMode = (value: unknown): value is StreamMode =>
  STREAM_MODES.some((mode) => mode === value)

/** A query value as a whole number at or above zero, or null when it is not one. */
const wholeNumber = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return value != null && value !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

/**
 * What a player needs beyond the file itself: the tracks to choose from,
 * subtitles as WebVTT, and a converted stream for files or tracks the
 * browser cannot play directly.
 */
@Controller('api/media')
export class PlaybackController {
  constructor(
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(TracksService) private readonly tracks: TracksService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
  ) {}

  private find(id: number): MediaRecord {
    const record = this.media.get(id)
    if (!record) throw new NotFoundException(`No media ${id}`)
    return record
  }

  @Get(':id/tracks')
  async listTracks(@Param('id', ParseIntPipe) id: number): Promise<MediaTracks> {
    return (await this.tracks.tracksFor(this.find(id))).tracks
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
    const vtt = await this.subtitles.vtt({ record: this.find(id), trackId, window: part })
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
    const from = start == null ? 0 : Number(start)
    if (!Number.isFinite(from) || from < 0) {
      throw new BadRequestException('start must be a number of seconds')
    }
    const record = this.find(id)
    const info = await stat(record.path).catch(() => null)
    if (!info?.isFile()) throw new NotFoundException('The file is no longer on disk')

    const { tracks } = await this.tracks.tracksFor(record)
    const chosen = audio == null ? tracks.defaultAudio : wholeNumber(audio)
    if (
      audio != null &&
      (chosen == null || !tracks.audio.some((track) => track.index === chosen))
    ) {
      throw new BadRequestException(`No audio track ${audio}`)
    }
    const tonemap = mode === 'transcode' && record.hdr && (await this.ffmpeg.canTonemap())
    const encoder = mode === 'transcode' ? await this.ffmpeg.videoEncoder() : SOFTWARE

    const child = this.ffmpeg.stream(
      streamArgs({
        input: record.path,
        start: from,
        mode,
        audio: chosen,
        videoCodec: record.videoCodec,
        tonemap,
        streamShift: STREAM_TIME_SHIFT,
        encoder,
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
