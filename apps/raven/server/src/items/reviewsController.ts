import { Controller, Get, Inject, Param, ParseIntPipe, Query, Res } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { sendImage } from '@/items/sendImage'
import { Public } from '@/lock/lockGuard'
import { ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** A review's id names only its author's avatar, which is TMDB's and in no library. */
@Controller('api/reviews')
@Public()
export class ReviewsController {
  constructor(
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(ImageCache) private readonly images: ImageCache,
  ) {}

  /** A reviewer's avatar, when TMDB hosts it; fetched and cached on first use. */
  @Get(':id/avatar')
  async avatar(
    @Param('id', ParseIntPipe) id: number,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const avatar = this.metadata.reviewAvatar(id)
    const path = avatar == null ? null : await this.images.tmdb({ path: avatar, use: 'photo' })
    await sendImage({ reply, path, version })
  }
}
