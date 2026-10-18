import { Controller, Get, Inject } from '@nestjs/common'
import type { ItemSummary, PosterEntry } from '@raven/core'
import { MediaRepository } from '@/media/mediaRepository'
import { TitleFavourites } from '@/media/titleFavourites'

/**
 * Favourites cut across libraries, so they hang off their own root rather
 * than a library's. A locked library's are left out, whether or not the PIN
 * is entered.
 */
@Controller('api/favourites')
export class FavouritesController {
  constructor(
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(TitleFavourites) private readonly titles: TitleFavourites,
  ) {}

  /** Every favourite video, each with the poster its card shows. */
  @Get()
  list(): PosterEntry[] {
    return this.media.withPosters(this.media.listFavourites())
  }

  /** Every favourite show and season. */
  @Get('titles')
  listTitles(): ItemSummary[] {
    return this.titles.list()
  }
}
