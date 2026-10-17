import { Controller, Get, Headers, Inject } from '@nestjs/common'
import type { PosterEntry } from '@raven/core'
import { RAVEN_HEADERS } from '@/http'
import { LockService } from '@/lock/lockService'
import { MediaRepository } from '@/media/mediaRepository'

/** Favourites cut across libraries, so they hang off their own root rather than a library's. */
@Controller('api/favourites')
export class FavouritesController {
  constructor(
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(LockService) private readonly lock: LockService,
  ) {}

  /** Every favourite but those in a library still locked, each with the poster its card shows. */
  @Get()
  list(@Headers(RAVEN_HEADERS.cookie) cookie: string | undefined): PosterEntry[] {
    const viewer = this.lock.viewer({ cookie })
    return this.media.withPosters(
      this.media.listFavourites().filter((item) => viewer.seesLibrary(item.libraryId)),
    )
  }
}
