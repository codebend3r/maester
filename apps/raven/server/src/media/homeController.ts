import { Controller, Get, Headers, Inject } from '@nestjs/common'
import { type Home, type HomeShelf, listsShows } from '@raven/core'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { LockService } from '@/lock/lockService'
import { MediaRepository } from '@/media/mediaRepository'

/** How many of a pinned library's newest arrivals its shelf on the home page holds. */
export const SHELF_SIZE = 8

/** The home page cuts across libraries, as favourites do, so it hangs off its own root. */
@Controller('api/home')
export class HomeController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(LockService) private readonly lock: LockService,
  ) {}

  /**
   * Every video in progress with the poster its card shows, then each pinned
   * library's newest arrivals; libraries still locked stay out.
   */
  @Get()
  home(@Headers('cookie') cookie: string | undefined): Home {
    const viewer = this.lock.viewer({ cookie })
    const shelves = this.libraries
      .list()
      .filter((library) => library.settings.pinned && viewer.seesLibrary(library.id))
      .map(({ id, settings }): HomeShelf => {
        const newest = { libraryId: id, sort: 'added', limit: SHELF_SIZE } as const
        return listsShows(settings.kind)
          ? { libraryId: id, type: 'shows', shows: this.media.listShows(newest) }
          : { libraryId: id, type: 'media', media: this.media.list(newest) }
      })
    return {
      inProgress: this.media.withPosters(
        this.media.listInProgress().filter((media) => viewer.seesLibrary(media.libraryId)),
      ),
      shelves,
    }
  }
}
