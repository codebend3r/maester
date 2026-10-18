import { Controller, Get, Headers, Inject, Query } from '@nestjs/common'
import {
  HOME_SHELF_TYPES,
  type Home,
  type HomeSearch,
  type HomeShelf,
  type MediaSort,
  isString,
  listsShows,
} from '@raven/core'
import { RAVEN_HEADERS } from '@/http'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import { LockService, type Viewer } from '@/lock/lockService'
import { MediaRepository } from '@/media/mediaRepository'

/** How many of a pinned library's newest arrivals its shelf on the home page holds. */
const SHELF_SIZE = 8

/** How many of a library's matches a search from home shows; the library's own search lists them all. */
const SEARCH_SHELF_SIZE = 16

/** The home page cuts across libraries, as favourites do, so it hangs off its own root. */
@Controller('api/home')
export class HomeController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(LockService) private readonly lock: LockService,
  ) {}

  /** A library's row: its shows for a TV shows library, its videos for any other. */
  private shelf({
    library: { id, settings },
    search,
    sort,
    limit,
  }: {
    library: LibraryRecord
    search: string
    sort: MediaSort
    limit: number
  }): HomeShelf {
    const listing = { libraryId: id, search, sort, limit }
    return listsShows(settings.kind)
      ? { libraryId: id, type: 'shows', shows: this.media.listShows(listing) }
      : { libraryId: id, type: 'media', media: this.media.list(listing) }
  }

  /** The libraries `viewer` may see, as the side menu orders them. */
  private seenBy(viewer: Viewer): LibraryRecord[] {
    return this.libraries.list().filter((library) => viewer.seesLibrary(library.id))
  }

  /**
   * Every video in progress with the poster its card shows, then each pinned
   * library's newest arrivals; libraries still locked stay out.
   */
  @Get()
  home(@Headers(RAVEN_HEADERS.cookie) cookie: string | undefined): Home {
    const viewer = this.lock.viewer({ cookie })
    const shelves = this.seenBy(viewer)
      .filter((library) => library.settings.pinned)
      .map((library) => this.shelf({ library, search: '', sort: 'added', limit: SHELF_SIZE }))
    return {
      inProgress: this.media.withPosters(
        this.media.listInProgress().filter((media) => viewer.seesLibrary(media.libraryId)),
      ),
      shelves,
    }
  }

  /**
   * What `?q=` finds in every library, pinned or not, by title: a row for
   * each library holding a match, and nothing for a blank search. Locked
   * libraries stay out, whether or not the PIN is entered.
   */
  @Get('search')
  search(@Query('q') q: unknown): HomeSearch {
    const search = isString(q) ? q.trim() : ''
    if (!search) return []
    return this.libraries
      .list()
      .filter((library) => !library.settings.locked)
      .map((library) => this.shelf({ library, search, sort: 'title', limit: SEARCH_SHELF_SIZE }))
      .filter(
        (shelf) => (shelf.type === HOME_SHELF_TYPES.shows ? shelf.shows : shelf.media).length > 0,
      )
  }
}
