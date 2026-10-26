import { createReadStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  THUMBNAIL_STATES,
  containerMimeType,
  isFavouriteChange,
  isProgressChange,
  isProgressReport,
  isRecord,
  isString,
  MEDIA_TICKET_PARAM,
  PLAYBACK_MODES,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { AccessRechecks } from '@/auth/accessRechecks'
import { OpenedByPass, PASS_KINDS } from '@/auth/accountPasses'
import { AuthSessions } from '@/auth/authSessions'
import { ERROR_CODES, errorMessage } from '@/errorMessage'
import { RAVEN_CACHE_POLICIES, RAVEN_HEADERS } from '@/http'
import { sendImage } from '@/items/sendImage'
import { PrivateBy } from '@/lock/lockGuard'
import { FAVOURITE_OUTCOMES } from '@/media/favouriteOutcomes'
import { FilePasses } from '@/media/filePasses'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { MediaRepository } from '@/media/mediaRepository'
import { RANGE_OUTCOMES, RANGE_UNITS, parseRange } from '@/media/range'
import { ViewingAccounts } from '@/media/viewingAccounts'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingRepository } from '@/media/viewingRepository'
import { parseBody } from '@/parseBody'
import { ScannerService } from '@/scanner/scannerService'
import { clientOf, trackStream } from '@/streams/trackStream'
import { StreamSessions } from '@/streams/streamSessions'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const errorCode = (error: unknown): string =>
  isRecord(error) && isString(error.code) ? error.code : ''

/**
 * Video bytes come off the share in 1 MiB reads rather than Node's default
 * 64 KiB: over SMB every read is a round trip, so bigger reads mean fewer.
 */
const READ_CHUNK = 1024 * 1024

type ReadFileProps = { path: string; start?: number; end?: number }

const readFile = ({ path, start, end }: ReadFileProps) =>
  createReadStream(path, { start, end, highWaterMark: READ_CHUNK })

/** What a client is told when the file stays put. Never the path: that stays server-side. */
const deleteFailure = (error: unknown): string => {
  const code = errorCode(error)
  if (code === ERROR_CODES.erofs) {
    return 'Could not delete the file: its folder is mounted read-only.'
  }
  if (code === ERROR_CODES.eacces || code === ERROR_CODES.eperm) {
    return 'Could not delete the file: the server is not allowed to write to its folder.'
  }
  return `Could not delete the file${code ? ` (${code})` : ''}.`
}

type MediaControllerFindProps = { id: number; account: AccountKey }

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
    @Inject(StreamSessions) private readonly streams: StreamSessions,
    @Inject(AccessRechecks) private readonly rechecks: AccessRechecks,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(AuthSessions) private readonly callers: AuthSessions,
    @Inject(FilePasses) private readonly passes: Pick<FilePasses, 'hold'>,
  ) {}

  private find({ id, account }: MediaControllerFindProps): MediaItem {
    const item = this.media.get({ id, account })
    if (!item) throw new NotFoundException(`No media ${id}`)
    return item
  }

  private fileOf(id: number): MediaFile {
    const file = this.index.fileOf(id)
    if (!file) throw new NotFoundException(`No media ${id}`)
    return file
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): MediaItem {
    return this.find({ id, account: this.accounts.keyOf({ request }) })
  }

  /** Where the file lives, for the card's menu: the one call that hands a client a path. */
  @AdminOnly()
  @Get(':id/location')
  location(@Param('id', ParseIntPipe) id: number): MediaLocation {
    return { path: this.fileOf(id).path }
  }

  @ForViewers()
  @Put(':id/progress')
  @HttpCode(204)
  saveProgress(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): void {
    const { position } = parseBody({
      guard: isProgressChange,
      body,
      message: 'position must be a number of seconds',
    })
    // An older player names no audio track; null keeps the one the stream knew.
    const audio = isProgressReport(body) ? body.audio : null
    this.streams.report({
      mediaId: id,
      client: clientOf({ request, auth: this.callers }),
      position,
      audio,
    })
    if (!this.viewing.report({ id, position, account: this.accounts.keyOf({ request }) })) {
      throw new NotFoundException(`No media ${id}`)
    }
  }

  /** The player says a video started, for its library's history. */
  @ForViewers()
  @Post(':id/plays')
  @HttpCode(204)
  recordPlay(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): void {
    if (!this.viewing.recordPlay({ id, account: this.accounts.keyOf({ request }) })) {
      throw new NotFoundException(`No media ${id}`)
    }
  }

  @ForViewers()
  @Put(':id/favourite')
  setFavourite(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): MediaItem {
    const { favourite } = parseBody({
      guard: isFavouriteChange,
      body,
      message: 'favourite must be true or false',
    })
    const account = this.accounts.keyOf({ request })
    const outcome = this.viewing.setFavourite({ id, favourite, account })
    switch (outcome) {
      case FAVOURITE_OUTCOMES.done:
        return this.find({ id, account })
      case FAVOURITE_OUTCOMES.missing:
        throw new NotFoundException(`No media ${id}`)
      case FAVOURITE_OUTCOMES.locked:
        throw new ForbiddenException('A locked library’s videos cannot be favourites.')
      default: {
        const unknown: never = outcome
        return unknown
      }
    }
  }

  /**
   * Deletes the file itself, then the index row (progress and favourite go
   * with it), then what was kept of it: thumbnail, subtitles, tracks. Waits
   * for a running scan first so the two never race over the same row. A
   * file that is already gone still loses its row; any other failure, such
   * as a read-only mount, keeps the row and says why.
   */
  @AdminOnly()
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    const file = this.fileOf(id)
    await this.scanner.whenIdle(file.libraryId)
    try {
      await unlink(file.path)
    } catch (error) {
      if (errorCode(error) !== ERROR_CODES.enoent) {
        this.logger.warn(`Could not delete ${file.path}: ${errorMessage(error)}`)
        throw new InternalServerErrorException(deleteFailure(error))
      }
    }
    this.index.remove([id])
    await this.artifacts.discard([id])
  }

  @Get(':id/thumbnail')
  async thumbnail(
    @Param('id', ParseIntPipe) id: number,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = this.fileOf(id)
    const path = file.thumbnail === THUMBNAIL_STATES.ready ? this.thumbnails.pathFor(id) : null
    await sendImage({ reply, path, version })
  }

  /**
   * Direct play: the file itself, with byte ranges. The browser asks for the
   * first bytes, finds the index, and starts playing; seeking is just another
   * range request, so the server does nothing but read. Files the client
   * cannot decode as they are go through `PlaybackController`'s stream. An
   * account ticket that opens the file earns a pass, so the native player's
   * later ranges, which carry that same ticket, outlive its five minutes.
   */
  @MediaPlane()
  @OpenedByPass(PASS_KINDS.ticket)
  @Get(':id/file')
  async file(
    @Param('id', ParseIntPipe) id: number,
    @Query(MEDIA_TICKET_PARAM) ticket: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = this.fileOf(id)
    const info = await stat(file.path).catch(() => null)
    if (!info?.isFile()) throw new NotFoundException('The file is no longer on disk')
    this.passes.hold({ request, ticket, mediaId: id })

    trackStream({
      sessions: this.streams,
      rechecks: this.rechecks,
      auth: this.callers,
      mediaId: id,
      mode: PLAYBACK_MODES.direct,
      quality: null,
      audio: null,
      request,
      reply,
    })
    const size = info.size
    const range = parseRange({ header: request.headers.range, size })
    reply
      .header(RAVEN_HEADERS.acceptRanges, RANGE_UNITS.bytes)
      .header(HEADERS.contentType, containerMimeType(file.container) ?? CONTENT_TYPES.octetStream)
      .header(HEADERS.cacheControl, RAVEN_CACHE_POLICIES.privateRevalidate)

    if (range === RANGE_OUTCOMES.unsatisfiable) {
      await reply.code(416).header(HEADERS.contentRange, `${RANGE_UNITS.bytes} */${size}`).send()
      return
    }
    if (range == null) {
      await reply.header(HEADERS.contentLength, size).send(readFile({ path: file.path }))
      return
    }
    await reply
      .code(206)
      .header(HEADERS.contentRange, `${RANGE_UNITS.bytes} ${range.start}-${range.end}/${size}`)
      .header(HEADERS.contentLength, range.end - range.start + 1)
      .send(readFile({ path: file.path, start: range.start, end: range.end }))
  }
}
