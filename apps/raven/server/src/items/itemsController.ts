import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type ImageOption,
  isRecord,
  isString,
  type ItemDetails,
  type ItemImageKind,
  type ItemImageOptions,
  type MediaItem,
} from '@raven/core'
import type { FastifyReply } from 'fastify'
import { sendImage } from '@/items/sendImage'
import { MediaRepository, toMediaItem } from '@/media/mediaRepository'
import { ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { LOCAL } from '@/metadata/metadataService'
import { TMDB_IMAGE_PATH, TmdbClient, TmdbError } from '@/metadata/tmdbClient'

const IMAGE_KINDS: readonly ItemImageKind[] = ['poster', 'backdrop', 'still']

const isImageKind = (value: string): value is ItemImageKind =>
  IMAGE_KINDS.some((kind) => kind === value)

/** Movies, shows, seasons and episodes: their pages, their pictures, and fetching them again. */
@Controller('api/items')
export class ItemsController {
  constructor(
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MetadataService) private readonly service: MetadataService,
    @Inject(ImageCache) private readonly images: ImageCache,
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
  ) {}

  private details(id: number): ItemDetails {
    const details = this.metadata.details(id)
    if (!details) throw new NotFoundException(`No item ${id}`)
    return {
      ...details,
      versions: this.media.forItem(id).map(toMediaItem),
      children: this.metadata.childrenOnDisk(id),
    }
  }

  /**
   * Fix match for a show: every file under it moves to the show with
   * `tmdbId`, keeping its season and episode numbers, and the choice is
   * kept by folder. Answers with the show the files moved to.
   */
  @Put(':id/match')
  async setMatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<ItemDetails> {
    const item = this.metadata.get(id)
    if (!item) throw new NotFoundException(`No item ${id}`)
    if (item.type !== 'show') throw new BadRequestException('Only a show can be re-pointed here.')
    if (!isRecord(body) || !isString(body.tmdbId) || !/^\d+$/.test(body.tmdbId)) {
      throw new BadRequestException('tmdbId must be a TMDB id')
    }
    if (!this.tmdb.enabled)
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to search TMDB.')
    const moved = await this.service
      .fixShowMatch({ showId: id, tmdbId: body.tmdbId })
      .catch((error: unknown) => {
        if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
        throw error
      })
    if (moved == null) throw new NotFoundException('TMDB has no show with that id.')
    return this.details(moved)
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): ItemDetails {
    return this.details(id)
  }

  /** A show's first episode not yet watched, for its Play button; null once every one is. */
  @Get(':id/next')
  next(@Param('id', ParseIntPipe) id: number): MediaItem | null {
    const item = this.metadata.get(id)
    if (!item) throw new NotFoundException(`No item ${id}`)
    const record = this.media.nextEpisode(id)
    return record ? toMediaItem(record) : null
  }

  /** Fetches the item from TMDB again now. One TMDB no longer has is gone after, so 404. */
  @Post(':id/refresh')
  @HttpCode(200)
  async refresh(@Param('id', ParseIntPipe) id: number): Promise<ItemDetails> {
    this.details(id)
    if (!this.tmdb.enabled) {
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to fetch details from TMDB.')
    }
    try {
      const kept = await this.service.refresh(id)
      if (!kept) throw new NotFoundException('TMDB no longer has this; it will be matched again.')
    } catch (error) {
      if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
      throw error
    }
    return this.details(id)
  }

  /**
   * Edit images: every poster and backdrop a movie or show could show, the
   * one beside the media first, then TMDB's, with the current one marked.
   */
  @Get(':id/images')
  async imageOptions(@Param('id', ParseIntPipe) id: number): Promise<ItemImageOptions> {
    const item = this.metadata.get(id)
    if (!item) throw new NotFoundException(`No item ${id}`)
    if (item.type !== 'movie' && item.type !== 'show') {
      throw new BadRequestException('Only a movie or show has pictures to choose from.')
    }
    const fetched =
      this.tmdb.enabled && !item.tmdbId.startsWith(LOCAL)
        ? await this.tmdb
            .images({ type: item.type, tmdbId: item.tmdbId })
            .catch((error: unknown) => {
              if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
              throw error
            })
        : { posters: [], backdrops: [] }
    const options = (kind: 'poster' | 'backdrop'): ImageOption[] => {
      const current = this.metadata.image({ itemId: id, kind })
      const local = this.metadata.imageFrom({ itemId: id, kind, source: 'local' })
      const own = this.metadata.imageFrom({ itemId: id, kind, source: 'tmdb' })
      const tmdb = kind === 'poster' ? fetched.posters : fetched.backdrops
      // TMDB's own choice is offered even when the images call left it out.
      const listed =
        own != null && !tmdb.some((image) => image.path === own)
          ? [{ path: own, width: null, height: null, language: null }, ...tmdb]
          : tmdb
      return [
        ...(local == null
          ? []
          : [
              {
                source: 'local' as const,
                ref: local,
                width: null,
                height: null,
                language: null,
                current: current?.source === 'local',
              },
            ]),
        ...listed.map((image) => ({
          source: 'tmdb' as const,
          ref: image.path,
          width: image.width,
          height: image.height,
          language: image.language,
          current: current?.source !== 'local' && current?.ref === image.path,
        })),
      ]
    }
    return { poster: options('poster'), backdrop: options('backdrop') }
  }

  /** Edit images: `{ source: 'tmdb', ref }` shows that picture of TMDB's; `{ source: 'local' }` goes back to the one beside the media, or TMDB's own. */
  @Put(':id/images/:kind')
  async chooseImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ): Promise<ItemDetails> {
    if (kind !== 'poster' && kind !== 'backdrop') {
      throw new NotFoundException(`No ${kind} pictures to choose`)
    }
    this.details(id)
    if (!isRecord(body) || (body.source !== 'tmdb' && body.source !== 'local')) {
      throw new BadRequestException('source must be tmdb or local')
    }
    if (body.source === 'tmdb' && (!isString(body.ref) || !TMDB_IMAGE_PATH.test(body.ref))) {
      throw new BadRequestException('ref must be a TMDB image path')
    }
    const ref = body.source === 'tmdb' && isString(body.ref) ? body.ref : null
    this.metadata.chooseImage({ itemId: id, kind, ref })
    return this.details(id)
  }

  /** The picture beside the media, scaled, whatever the item shows: Edit images previews it. */
  @Get(':id/images/:kind/local')
  async localImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isImageKind(kind)) throw new NotFoundException(`No ${kind} pictures`)
    const local = this.metadata.imageFrom({ itemId: id, kind, source: 'local' })
    const path =
      local == null ? null : await this.images.local({ itemId: id, kind, source: local, use: kind })
    await sendImage({ reply, path, version: undefined })
  }

  /** A poster, backdrop or still: the chosen picture first, then one beside the media, then TMDB's. */
  @Get(':id/images/:kind')
  async image(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isImageKind(kind)) throw new NotFoundException(`No ${kind} pictures`)
    const image = this.metadata.image({ itemId: id, kind })
    const chosen =
      image?.source === 'chosen' ? await this.images.tmdb({ path: image.ref, use: kind }) : null
    const localRef =
      image?.source === 'local'
        ? image.ref
        : this.metadata.imageFrom({ itemId: id, kind, source: 'local' })
    const local =
      chosen == null && localRef != null
        ? await this.images.local({ itemId: id, kind, source: localRef, use: kind })
        : null
    // A picture beside the media that will not decode falls back to TMDB's.
    const tmdbPath =
      chosen == null && local == null ? this.metadata.tmdbImage({ itemId: id, kind }) : null
    const path =
      chosen ??
      local ??
      (tmdbPath == null ? null : await this.images.tmdb({ path: tmdbPath, use: kind }))
    await sendImage({ reply, path, version })
  }
}
