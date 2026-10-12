import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  isMatchChoice,
  isMatchItemType,
  type MatchCandidate,
  type MediaItem,
  matchTypeFor,
} from '@raven/core'
import type { FastifyReply } from 'fastify'
import { isChoosableImageKind } from '@/items/imageKinds'
import { sendImage } from '@/items/sendImage'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { MediaRepository } from '@/media/mediaRepository'
import { ImageCache } from '@/metadata/imageCache'
import { MetadataService } from '@/metadata/metadataService'
import { TMDB_IMAGE_PATH, TmdbClient, TmdbError } from '@/metadata/tmdbClient'

const tmdbFailure = (error: unknown): never => {
  if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
  throw error
}

/** Fix match: searching TMDB from a page, and pointing a file at what the viewer picks. */
@Controller('api')
export class MatchController {
  constructor(
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MetadataService) private readonly service: MetadataService,
    @Inject(ImageCache) private readonly images: ImageCache,
  ) {}

  private requireTmdb(): void {
    if (!this.tmdb.enabled) {
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to search TMDB.')
    }
  }

  @Get('match/search')
  async search(
    @Query('type') type: string | undefined,
    @Query('query') query: string | undefined,
    @Query('year') year: string | undefined,
  ): Promise<MatchCandidate[]> {
    if (!isMatchItemType(type)) throw new BadRequestException('type must be movie or show')
    if (!query?.trim()) throw new BadRequestException('Search for a title.')
    this.requireTmdb()
    const parsedYear = Number.parseInt(year ?? '', 10)
    const asked = { query: query.trim(), year: Number.isInteger(parsedYear) ? parsedYear : null }
    const results = await (
      type === 'movie' ? this.tmdb.searchMovies(asked) : this.tmdb.searchShows(asked)
    ).catch(tmdbFailure)
    return results.map(({ tmdbId, title, year: released, overview, poster }) => ({
      tmdbId,
      title,
      year: released,
      overview,
      poster,
    }))
  }

  /**
   * A search result's poster, or a poster, backdrop or logo Edit images
   * offers, through the cache, so the browser never talks to TMDB.
   */
  @Public()
  @Get('images/:use/:file')
  async candidate(
    @Param('use') use: string,
    @Param('file') file: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const path = `/${file}`
    if (!isChoosableImageKind(use) || !TMDB_IMAGE_PATH.test(path)) {
      throw new NotFoundException('No such picture')
    }
    await sendImage({ reply, path: await this.images.tmdb({ path, use }), version: file })
  }

  /**
   * Saves a Fix match: `{ tmdbId }` points the file (and its folder, when
   * that holds one movie or show) at a TMDB movie or show; `{ tmdbId: null }`
   * says it is not one. Kept through renames, and never replaced by matching.
   */
  @PrivateBy('media')
  @Put('media/:id/match')
  async setMatch(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<MediaItem> {
    const record = this.media.get(id)
    if (!record) throw new NotFoundException(`No media ${id}`)
    if (!isMatchChoice(body)) throw new BadRequestException('tmdbId must be a TMDB id or null')
    const kind = this.libraries.get(record.libraryId)?.settings.kind
    if (kind == null || matchTypeFor(kind) == null) {
      throw new BadRequestException('Only files in a library of movies or shows can be matched.')
    }
    const tmdbId = body.tmdbId
    if (tmdbId != null) this.requireTmdb()
    await this.service.fixMatch({ mediaId: id, tmdbId }).catch(tmdbFailure)
    const updated = this.media.get(id)
    if (!updated) throw new NotFoundException(`No media ${id}`)
    return updated
  }
}
