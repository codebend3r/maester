import { createReadStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import {
  BadRequestException,
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
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import { type MediaItem, containerMimeType, isNumber, isRecord, isString } from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { type MediaRecord, MediaRepository, toMediaItem } from '@/media/mediaRepository.js'
import { parseRange } from '@/media/range.js'
import { ScannerService } from '@/scanner/scannerService.js'
import { ThumbnailService } from '@/thumbnails/thumbnailService.js'

const errorCode = (error: unknown): string =>
  isRecord(error) && isString(error.code) ? error.code : ''

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
export class MediaController {
  private readonly logger = new Logger(MediaController.name)

  constructor(
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(ScannerService) private readonly scanner: ScannerService,
  ) {}

  private find(id: number): MediaRecord {
    const record = this.media.get(id)
    if (!record) throw new NotFoundException(`No media ${id}`)
    return record
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): MediaItem {
    return toMediaItem(this.find(id))
  }

  @Put(':id/progress')
  @HttpCode(204)
  saveProgress(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): void {
    this.find(id)
    if (!isRecord(body) || !isNumber(body.position) || body.position < 0) {
      throw new BadRequestException('position must be a number of seconds')
    }
    this.media.saveProgress({ id, position: body.position })
  }

  @Put(':id/favourite')
  setFavourite(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): MediaItem {
    this.find(id)
    if (!isRecord(body) || typeof body.favourite !== 'boolean') {
      throw new BadRequestException('favourite must be true or false')
    }
    this.media.setFavourite({ id, favourite: body.favourite })
    return toMediaItem(this.find(id))
  }

  /**
   * Deletes the file itself, then the index row (progress and favourite go
   * with it) and the cached thumbnail. Waits for a running scan first so the
   * two never race over the same row. A file that is already gone still
   * loses its row; any other failure, such as a read-only mount, keeps the
   * row and says why.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    const record = this.find(id)
    await this.scanner.whenIdle(record.libraryId)
    try {
      await unlink(record.path)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.logger.warn(
          `Could not delete ${record.path}: ${error instanceof Error ? error.message : String(error)}`,
        )
        throw new InternalServerErrorException(deleteFailure(error))
      }
    }
    await this.thumbnails.discard([id])
    this.media.removeMany([id])
  }

  /** Versioned URLs (`?v=`) change whenever the file does, so they can be cached for good. */
  @Get(':id/thumbnail')
  async thumbnail(
    @Param('id', ParseIntPipe) id: number,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const record = this.find(id)
    const path = this.thumbnails.pathFor(id)
    const info = record.thumbnail === 'ready' ? await stat(path).catch(() => null) : null
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
   * range request, so the server does nothing but read. There is no
   * transcoding: a file the client cannot decode is reported as such by
   * `checkDirectPlay` rather than converted.
   */
  @Get(':id/file')
  async file(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const record = this.find(id)
    const info = await stat(record.path).catch(() => null)
    if (!info?.isFile()) throw new NotFoundException('The file is no longer on disk')

    const size = info.size
    const range = parseRange({ header: request.headers.range, size })
    reply
      .header('accept-ranges', 'bytes')
      .header('content-type', containerMimeType(record.container) ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=0, must-revalidate')

    if (range === 'unsatisfiable') {
      await reply.code(416).header('content-range', `bytes */${size}`).send()
      return
    }
    if (range == null) {
      await reply.header('content-length', size).send(createReadStream(record.path))
      return
    }
    await reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
      .header('content-length', range.end - range.start + 1)
      .send(createReadStream(record.path, { start: range.start, end: range.end }))
  }
}
