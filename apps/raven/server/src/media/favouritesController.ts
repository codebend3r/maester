import { Controller, Get, Inject } from '@nestjs/common'
import type { MediaItem } from '@raven/core'
import { MediaRepository, toMediaItem } from '@/media/mediaRepository'

/** Favourites cut across libraries, so they hang off their own root rather than a library's. */
@Controller('api/favourites')
export class FavouritesController {
  constructor(@Inject(MediaRepository) private readonly media: MediaRepository) {}

  @Get()
  list(): MediaItem[] {
    return this.media.listFavourites().map(toMediaItem)
  }
}
