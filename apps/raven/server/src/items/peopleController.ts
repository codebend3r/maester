import { Controller, Get, Inject, Param, ParseIntPipe, Query, Res } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { sendImage } from '@/items/sendImage'
import { ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'

@Controller('api/people')
export class PeopleController {
  constructor(
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(ImageCache) private readonly images: ImageCache,
  ) {}

  /** A person's photo from TMDB, fetched and cached on first use. */
  @Get(':id/photo')
  async photo(
    @Param('id', ParseIntPipe) id: number,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const photo = this.metadata.photo(id)
    const path = photo == null ? null : await this.images.tmdb({ path: photo, use: 'photo' })
    await sendImage({ reply, path, version })
  }
}
