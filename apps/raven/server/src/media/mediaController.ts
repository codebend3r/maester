import { createReadStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import {
  type MediaItem,
  type MediaLocation,
  containerMimeType,
  isFavouriteChange,
  isProgressChange,
  isRecord,
  isString,
} from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { errorMessage } from '@/errorMessage'
import { PrivateBy } from '@/lock/lockGuard'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { parseRange } from '@/media/range'
import { ViewingRepository } from '@/media/viewingRepository'
import { parseBody } from '@/parseBody'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const errorCode = (error: unknown): string =>
  isRecord(error) && isString(error.code) ? error.code : ''

/**
 * Video bytes come off the share in 1 MiB reads rather than Node's default
 * 64 KiB: over SMB every read is a round trip, so bigger reads mean fewer.
 */
const READ_CHUNK = 1024 * 1024

const readFile = ({ path, start, end }: { path: string; start?: number; end?: number }) =>
  createReadStream(path, { start, end, highWaterMark: READ_CHUNK })

/** What a client is told when the file stays put. Never the path: that stays server-side. */
const deleteFailure = (error: unknown): string => {
  const code = errorCode(error)
  if (code === 'EROFS') return 'Could not delete the file: its folder is mounted read-only.'
  if (code === 'EACCES' || code === 'EPERM') {
    return 'Could not delete the file: the server is not allowed to write to its folder.'
  }
  return `Could not delete the file${code ? ` (${code})` : ''}.`
}

@Controller('api/media')
@PrivateBy('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name)

  constructor(
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(ViewingRepository) private readonly viewing: ViewingRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(MediaArtifacts) private readonly artifacts: MediaArtifacts,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(ScannerService) private readonly scanner: ScannerService,
  ) {}

  private find(id: number): MediaItem {
    const item = this.media.get(id)
    if (!item) throw new NotFoundException(`No media ${id}`)
    return item
  }

  private fileOf(id: number): MediaFile {
    const file = this.index.fileOf(id)
    if (!file) throw new NotFoundException(`No media ${id}`)
    return file
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): MediaItem {
    return this.find(id)
  }

  /** Where the file lives, for the card's menu: the one call that hands a client a path. */
  @Get(':id/location')
  location(@Param('id', ParseIntPipe) id: number): MediaLocation {
    return { path: this.fileOf(id).path }
  }

  @Put(':id/progress')
  @HttpCode(204)
  saveProgress(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): void {
    const { position } = parseBody({
      guard: isProgressChange,
      body,
      message: 'position must be a number of seconds',
    })
    if (!this.viewing.report({ id, position })) {
      throw new NotFoundException(`No media ${id}`)
    }
  }

  /** The player says a video started, for its library's history. */
  @Post(':id/plays')
  @HttpCode(204)
  recordPlay(@Param('id', ParseIntPipe) id: number): void {
    if (!this.viewing.recordPlay({ id })) throw new NotFoundException(`No media ${id}`)
  }

  @Put(':id/favourite')
  setFavourite(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): MediaItem {
    const { favourite } = parseBody({
      guard: isFavouriteChange,
      body,
      message: 'favourite must be true or false',
    })
    if (!this.viewing.setFavourite({ id, favourite })) {
      throw new NotFoundException(`No media ${id}`)
    }
    return this.find(id)
  }

  /**
   * Deletes the file itself, then the index row (progress and favourite go
   * with it), then what was kept of it: thumbnail, subtitles, tracks. Waits
   * for a running scan first so the two never race over the same row. A
   * file that is already gone still loses its row; any other failure, such
   * as a read-only mount, keeps the row and says why.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    const file = this.fileOf(id)
    await this.scanner.whenIdle(file.libraryId)
    try {
      await unlink(file.path)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.logger.warn(`Could not delete ${file.path}: ${errorMessage(error)}`)
        throw new InternalServerErrorException(deleteFailure(error))
      }
    }
    this.index.remove([id])
    await this.artifacts.discard([id])
  }

  /** Versioned URLs (`?v=`) change whenever the file does, so they can be cached for good. */
  @Get(':id/thumbnail')
  async thumbnail(
    @Param('id', ParseIntPipe) id: number,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = this.fileOf(id)
    const path = this.thumbnails.pathFor(id)
    const info = file.thumbnail === 'ready' ? await stat(path).catch(() => null) : null
    if (!info) throw new NotFoundException('No thumbnail yet')
    await reply
      .header('content-type', 'image/jpeg')
      .header('content-length', info.size)
      .header(
        'cache-control',
        version ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      )
      .send(createReadStream(path))
  }

  /**
   * Direct play: the file itself, with byte ranges. The browser asks for the
   * first bytes, finds the index, and starts playing; seeking is just another
   * range request, so the server does nothing but read. Files the client
   * cannot decode as they are go through `PlaybackController`'s stream.
   */
  @Get(':id/file')
  async file(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = this.fileOf(id)
    const info = await stat(file.path).catch(() => null)
    if (!info?.isFile()) throw new NotFoundException('The file is no longer on disk')

    const size = info.size
    const range = parseRange({ header: request.headers.range, size })
    reply
      .header('accept-ranges', 'bytes')
      .header('content-type', containerMimeType(file.container) ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=0, must-revalidate')

    if (range === 'unsatisfiable') {
      await reply.code(416).header('content-range', `bytes */${size}`).send()
      return
    }
    if (range == null) {
      await reply.header('content-length', size).send(readFile({ path: file.path }))
      return
    }
    await reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
      .header('content-length', range.end - range.start + 1)
      .send(readFile({ path: file.path, start: range.start, end: range.end }))
  }
}
