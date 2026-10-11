import { Controller, Get, Headers, Inject } from '@nestjs/common'
import type { MediaItem } from '@raven/core'
import { LockService } from '@/lock/lockService'
import { MediaRepository, toMediaItem } from '@/media/mediaRepository'

/** Favourites cut across libraries, so they hang off their own root rather than a library's. */
@Controller('api/favourites')
export class FavouritesController {
  constructor(
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(LockService) private readonly lock: LockService,
  ) {}

  /** Every favourite but those in a library still locked. */
  @Get()
  list(@Headers('cookie') cookie: string | undefined): MediaItem[] {
    const viewer = this.lock.viewer({ cookie })
    return this.media
      .listFavourites()
      .filter((record) => viewer.seesLibrary(record.libraryId))
      .map(toMediaItem)
  }
}
