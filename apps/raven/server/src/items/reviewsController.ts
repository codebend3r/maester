import { Controller, Get, Inject, Param, ParseIntPipe, Query, Res } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { sendImage } from '@/items/sendImage'
import { Public } from '@/lock/lockGuard'
import { IMAGE_WIDTHS, ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { ROUTE_PARAMS } from '@/requestParts'
import { QUERY_PARAMS, queryText } from '@/queryValues'

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
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Query(QUERY_PARAMS.version) version: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const avatar = this.metadata.reviewAvatar(id)
    const path =
      avatar == null ? null : await this.images.tmdb({ path: avatar, width: IMAGE_WIDTHS.photo })
    await sendImage({
      reply,
      path,
      version: queryText({ value: version, name: QUERY_PARAMS.version }),
    })
  }
}
