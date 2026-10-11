import {
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { ItemDetails, ItemImageKind } from '@raven/core'
import type { FastifyReply } from 'fastify'
import { sendImage } from '@/items/sendImage'
import { MediaRepository, toMediaItem } from '@/media/mediaRepository'
import { ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { TmdbClient, TmdbError } from '@/metadata/tmdbClient'

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
      children: [],
    }
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): ItemDetails {
    return this.details(id)
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

  /** A poster, backdrop or still: a picture beside the media first, then TMDB's. */
  @Get(':id/images/:kind')
  async image(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isImageKind(kind)) throw new NotFoundException(`No ${kind} pictures`)
    const image = this.metadata.image({ itemId: id, kind })
    const local =
      image?.source === 'local'
        ? await this.images.local({ itemId: id, kind, source: image.ref, use: kind })
        : null
    // A picture beside the media that will not decode falls back to TMDB's.
    const tmdbPath = local == null ? this.metadata.tmdbImage({ itemId: id, kind }) : null
    const path =
      local ?? (tmdbPath == null ? null : await this.images.tmdb({ path: tmdbPath, use: kind }))
    await sendImage({ reply, path, version })
  }
}
