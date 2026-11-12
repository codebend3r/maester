import { type Stats, createReadStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import {
  BadRequestException,
  Body,
  ConflictException,
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
  AUDIO_BITRATE_PARAM,
  AUDIO_BITRATES,
  DEFAULT_DEVICE_DOWNLOAD_VARIANT,
  DEVICE_DOWNLOAD_PATHS,
  DEVICE_DOWNLOAD_VARIANT_PARAM,
  DEVICE_DOWNLOAD_VARIANTS,
  type DeviceDownload,
  type DeviceDownloadVariant,
  type MediaItem,
  type MediaLocation,
  type PlaybackMode,
  THUMBNAIL_STATES,
  containerMimeType,
  isAudioBitrate,
  isDeviceDownloadVariant,
  isAudioContainer,
  isFavouriteChange,
  isProgressChange,
  isProgressReport,
  isRecord,
  isStreamPurpose,
  isString,
  MEDIA_PURPOSE_PARAM,
  MEDIA_TICKET_PARAM,
  PLAYBACK_MODES,
  SESSION_PARAMS,
  STREAM_PURPOSES,
  readSessionQuery,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { merge } from 'rxjs'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { AccessRechecks } from '@/auth/accessRechecks'
import { OpenedByPass, PASS_KINDS } from '@/auth/accountPasses'
import { AuthSessions } from '@/auth/authSessions'
import { ERROR_CODES, errorMessage } from '@/errorMessage'
import { RAVEN_CACHE_POLICIES, RAVEN_CONTENT_TYPES, RAVEN_HEADERS } from '@/http'
import { sendImage } from '@/items/sendImage'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { PrivateBy } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { DeviceDownloadCache } from '@/media/deviceDownloadCache'
import { FAVOURITE_OUTCOMES } from '@/media/favouriteOutcomes'
import { FilePasses } from '@/media/filePasses'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { MediaRepository } from '@/media/mediaRepository'
import { MEDIA_ROUTES, routeOf } from '@/media/mediaRoutes'
import { RANGE_OUTCOMES, RANGE_UNITS, parseRange } from '@/media/range'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { ServerEvents } from '@/events/serverEvents'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingRepository } from '@/media/viewingRepository'
import { TranscodeCache } from '@/music/transcodeCache'
import { parseBody } from '@/parseBody'
import { ScannerService } from '@/scanner/scannerService'
import { ScrobbleSender } from '@/scrobbling/scrobbleSender'
import { clientOf, trackStream } from '@/streams/trackStream'
import { StreamSessions } from '@/streams/streamSessions'
import { ThumbnailService } from '@/thumbnails/thumbnailService'
import { ROUTE_PARAMS } from '@/requestParts'

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

const MISSING_FILE = 'The file is no longer on disk'

/** What a copy's download is counted as among the streams: the picture copied, or encoded again. */
const DEVICE_DOWNLOAD_MODES = {
  [DEVICE_DOWNLOAD_VARIANTS.copy]: PLAYBACK_MODES.remux,
  [DEVICE_DOWNLOAD_VARIANTS.sdr]: PLAYBACK_MODES.transcode,
} as const satisfies Record<DeviceDownloadVariant, PlaybackMode>

/** The copy `?variant=` names, the picture's own when it names none, or a 400. */
const deviceDownloadVariantOf = (asked: unknown): DeviceDownloadVariant => {
  if (asked === undefined) return DEFAULT_DEVICE_DOWNLOAD_VARIANT
  if (!isDeviceDownloadVariant(asked)) {
    throw new BadRequestException(
      `${DEVICE_DOWNLOAD_VARIANT_PARAM} must be one of ${isDeviceDownloadVariant.values.join(', ')}`,
    )
  }
  return asked
}

type MediaControllerFindProps = { id: number; account: AccountKey }

/** A media's indexed file and what it is on disk now, which may have changed since the last scan. */
type MediaSource = { file: MediaFile; source: Stats }

type MediaControllerSendRangesProps = {
  id: number
  path: string
  contentType: string
  mode: PlaybackMode
  ticket: unknown
  purpose: unknown
  request: FastifyRequest
  reply: FastifyReply
  /** Runs once the response has closed, or at once when it never opens. */
  onEnd?: () => void
}

@Controller(MEDIA_ROUTES)
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
    @Inject(ServerEvents) private readonly events: ServerEvents,
    @Inject(AuthSessions) private readonly callers: AuthSessions,
    @Inject(FilePasses) private readonly passes: Pick<FilePasses, 'hold'>,
    @Inject(TranscodeCache) private readonly transcodes: Pick<TranscodeCache, 'fileFor' | 'hold'>,
    @Inject(DeviceDownloadCache)
    private readonly copies: Pick<DeviceDownloadCache, 'prepare' | 'open'>,
    @Inject(ScrobbleSender) private readonly scrobbles: Pick<ScrobbleSender, 'noteListen'>,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
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

  /** The file as it is on disk, for what is made of it; 404 when the index names one that is gone. */
  private async sourceOf(id: number): Promise<MediaSource> {
    const file = this.fileOf(id)
    const source = await stat(file.path).catch(() => null)
    if (source === null || !source.isFile()) throw new NotFoundException(MISSING_FILE)
    return { file, source }
  }

  @Get(':id')
  get(@Param(ROUTE_PARAMS.id, ParseIntPipe) id: number, @Req() request: FastifyRequest): MediaItem {
    return this.find({ id, account: this.accounts.keyOf({ request }) })
  }

  /**
   * What plays after this video in the session the query names, from the
   * same library (a shuffle's from any this caller may see), for the
   * player's up next; null at the session's end.
   */
  @Get(':id/next')
  next(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Query(SESSION_PARAMS.session) session: unknown,
    @Query(SESSION_PARAMS.scope) scope: unknown,
    @Req() request: FastifyRequest,
  ): MediaItem | null {
    const viewing = readSessionQuery({ session, scope })
    if (!viewing) throw new BadRequestException('session must name a viewing session')
    const account = this.accounts.keyOf({ request })
    const viewer = this.lock.viewer({ request })
    return this.media.nextInSession({
      media: this.find({ id, account }),
      session: viewing,
      libraryIds: this.libraries.ids().filter((libraryId) => viewer.seesLibrary(libraryId)),
      account,
    })
  }

  /** Where the file lives, for the card's menu: the one call that hands a client a path. */
  @AdminOnly()
  @Get(':id/location')
  location(@Param(ROUTE_PARAMS.id, ParseIntPipe) id: number): MediaLocation {
    return { path: this.fileOf(id).path }
  }

  @ForViewers()
  @Put(':id/progress')
  @HttpCode(204)
  saveProgress(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
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
    const account = this.accounts.keyOf({ request })
    if (!this.viewing.report({ id, position, account })) {
      throw new NotFoundException(`No media ${id}`)
    }
    this.events.viewingChanged(account)
  }

  /**
   * The player counted a play, for its library's history; a music track's
   * is forwarded to the services the account links.
   */
  @ForViewers()
  @Post(':id/plays')
  @HttpCode(204)
  recordPlay(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): void {
    const account = this.accounts.keyOf({ request })
    if (!this.viewing.recordPlay({ id, account })) throw new NotFoundException(`No media ${id}`)
    this.events.viewingChanged(account)
    try {
      this.scrobbles.noteListen({ mediaId: id, account })
    } catch {
      // The play is kept whatever scrobbling does; the error could name an account.
      this.logger.error('A play could not be queued for scrobbling.')
    }
  }

  @ForViewers()
  @Put(':id/favourite')
  setFavourite(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
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
  async remove(@Param(ROUTE_PARAMS.id, ParseIntPipe) id: number): Promise<void> {
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
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
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
   * later ranges, which carry that same ticket, outlive its five minutes; a
   * range still streaming as that pass ends is cut, as a recheck cuts it.
   * Raven's downloads name themselves with `?purpose=download`, so the
   * Streams page lists them apart; anything else is a play.
   */
  @MediaPlane()
  @OpenedByPass(PASS_KINDS.ticket)
  @Get(':id/file')
  async file(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Query(MEDIA_TICKET_PARAM) ticket: unknown,
    @Query(MEDIA_PURPOSE_PARAM) purpose: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = this.fileOf(id)
    await this.sendRanges({
      id,
      path: file.path,
      contentType: containerMimeType(file.container) ?? CONTENT_TYPES.octetStream,
      mode: PLAYBACK_MODES.direct,
      ticket,
      purpose,
      request,
      reply,
    })
  }

  /**
   * A track converted to AAC at `?kbps=`, for offline downloads and cellular
   * streaming: made on the first ask, which waits for it, and served from the
   * transcode cache with byte ranges, tickets and passes as `file` serves the
   * original. A bitrate core does not offer is a 400, and a video a 409.
   */
  @MediaPlane()
  @OpenedByPass(PASS_KINDS.ticket)
  @Get(':id/transcode')
  async transcode(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Query(AUDIO_BITRATE_PARAM) kbps: unknown,
    @Query(MEDIA_TICKET_PARAM) ticket: unknown,
    @Query(MEDIA_PURPOSE_PARAM) purpose: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bitrate = isString(kbps) && /^\d+$/.test(kbps) ? Number(kbps) : null
    if (!isAudioBitrate(bitrate)) {
      throw new BadRequestException(
        `${AUDIO_BITRATE_PARAM} must be one of ${Object.values(AUDIO_BITRATES).join(', ')}`,
      )
    }
    const { file, source } = await this.sourceOf(id)
    if (!isAudioContainer(file.container)) {
      throw new ConflictException('Only a track can be converted to AAC.')
    }
    const path = await this.transcodes
      .fileFor({
        mediaId: id,
        path: file.path,
        // The file on disk, which may have changed since the last scan, names what is cached of it.
        mtimeMs: source.mtimeMs,
        durationSeconds: file.duration,
        kbps: bitrate,
      })
      .catch((error: unknown) => {
        this.logger.warn(`Could not convert media ${id} to AAC: ${errorMessage(error)}`)
        throw new InternalServerErrorException('Could not convert the track.')
      })
    await this.sendRanges({
      id,
      path,
      contentType: RAVEN_CONTENT_TYPES.audioMp4,
      mode: PLAYBACK_MODES.transcode,
      ticket,
      purpose,
      request,
      reply,
      onEnd: this.transcodes.hold(path),
    })
  }

  /**
   * Where the MP4 copy of a video stands, for a device whose player cannot open the
   * original (an MKV on an iPad): asking starts it when none is cached or running, and the
   * device asks again every few seconds until it is `ready`, then downloads `deviceDownloadFile`.
   * `?variant=sdr` asks for the SDR copy a browser plays instead, an encode of its own; a
   * variant core does not name is a 400.
   * The copy is of the file on disk, so a file changed since the last scan gets a new one.
   * This asks `find`, the viewer's own view of the media, since the route is the account's;
   * `deviceDownloadFile` is on the media plane, where the ticket or pass that opens it
   * already stands for the account, so it reads the file alone.
   */
  @Get(routeOf(DEVICE_DOWNLOAD_PATHS.prepare))
  async deviceDownload(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Query(DEVICE_DOWNLOAD_VARIANT_PARAM) asked: unknown,
    @Req() request: FastifyRequest,
  ): Promise<DeviceDownload> {
    const variant = deviceDownloadVariantOf(asked)
    const media = this.find({ id, account: this.accounts.keyOf({ request }) })
    const { file, source } = await this.sourceOf(media.id)
    if (isAudioContainer(file.container)) {
      throw new ConflictException('Only a video is copied for a device.')
    }
    return this.copies.prepare({
      mediaId: id,
      path: file.path,
      mtimeMs: source.mtimeMs,
      durationSeconds: file.duration,
      videoCodec: file.videoCodec,
      variant,
    })
  }

  /**
   * The finished MP4 copy `deviceDownload` made, with byte ranges, tickets and passes as
   * `file` serves the original, so a long download outlives its ticket and resumes by range.
   * A copy not made yet, or one being made again, is a 409.
   */
  @MediaPlane()
  @OpenedByPass(PASS_KINDS.ticket)
  @Get(routeOf(DEVICE_DOWNLOAD_PATHS.file))
  async deviceDownloadFile(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Query(DEVICE_DOWNLOAD_VARIANT_PARAM) asked: unknown,
    @Query(MEDIA_TICKET_PARAM) ticket: unknown,
    @Query(MEDIA_PURPOSE_PARAM) purpose: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const variant = deviceDownloadVariantOf(asked)
    const { source } = await this.sourceOf(id)
    const copy = await this.copies.open({ mediaId: id, mtimeMs: source.mtimeMs, variant })
    if (!copy) throw new ConflictException('The copy for this device is not ready yet.')
    await this.sendRanges({
      id,
      path: copy.path,
      contentType: RAVEN_CONTENT_TYPES.mp4,
      mode: DEVICE_DOWNLOAD_MODES[variant],
      ticket,
      purpose,
      request,
      reply,
      onEnd: copy.release,
    })
  }

  /**
   * Sends the file at `path` with byte ranges as one tracked stream, which
   * ends when a recheck says so or when the pass the ticket earns ends.
   */
  private async sendRanges({
    id,
    path,
    contentType,
    mode,
    ticket,
    purpose,
    request,
    reply,
    onEnd,
  }: MediaControllerSendRangesProps): Promise<void> {
    const info = await stat(path).catch(() => null)
    if (info === null || !info.isFile()) {
      // No response opens, so nothing would run `onEnd` later.
      onEnd?.()
      throw new NotFoundException(MISSING_FILE)
    }
    const passEnded = this.passes.hold({ request, ticket, mediaId: id })
    const size = info.size
    const range = parseRange({ header: request.headers.range, size })

    trackStream({
      sessions: this.streams,
      ended: merge(this.rechecks.ended({ request }), passEnded),
      auth: this.callers,
      purpose: isStreamPurpose(purpose) ? purpose : STREAM_PURPOSES.play,
      mediaId: id,
      mode,
      quality: null,
      audio: null,
      from: range == null || range === RANGE_OUTCOMES.unsatisfiable ? 0 : range.start,
      request,
      reply,
      onEnd,
    })
    reply
      .header(RAVEN_HEADERS.acceptRanges, RANGE_UNITS.bytes)
      .header(HEADERS.contentType, contentType)
      .header(HEADERS.cacheControl, RAVEN_CACHE_POLICIES.privateRevalidate)

    if (range === RANGE_OUTCOMES.unsatisfiable) {
      await reply.code(416).header(HEADERS.contentRange, `${RANGE_UNITS.bytes} */${size}`).send()
      return
    }
    if (range == null) {
      await reply.header(HEADERS.contentLength, size).send(readFile({ path }))
      return
    }
    await reply
      .code(206)
      .header(HEADERS.contentRange, `${RANGE_UNITS.bytes} ${range.start}-${range.end}/${size}`)
      .header(HEADERS.contentLength, range.end - range.start + 1)
      .send(readFile({ path, start: range.start, end: range.end }))
  }
}
