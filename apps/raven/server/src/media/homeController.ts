import { Controller, Get, Req, Inject, Query } from '@nestjs/common'
import {
  type AlbumShelf,
  HOME_SHELF_TYPES,
  type Hero,
  type Home,
  type HomeSearch,
  type HomeShelf,
  MEDIA_SORTS,
  type MediaSort,
  LIBRARY_LISTINGS,
  SORT_DIRECTIONS,
  MUSIC_SORTS,
  isString,
  listingFor,
  listsShows,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { HeroSelection } from '@/hero/heroSelection'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import { LockService, type Viewer } from '@/lock/lockService'
import { MediaRepository } from '@/media/mediaRepository'
import { MusicRepository } from '@/music/musicRepository'
import { ViewingAccounts } from '@/media/viewingAccounts'
import type { AccountKey } from '@/media/viewingAccountKeys'

/** How many of a pinned library's newest releases its shelf on the home page holds. */
const SHELF_SIZE = 8

/** How many of a library's matches a search from home shows; the library's own search lists them all. */
const SEARCH_SHELF_SIZE = 16

type HomeControllerShelfProps = {
  library: LibraryRecord
  search: string
  sort: MediaSort
  limit: number
  account: AccountKey
}

/** The home page cuts across libraries, as favourites do, so it hangs off its own root. */
@Controller('api/home')
export class HomeController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(HeroSelection) private readonly hero: HeroSelection,
  ) {}

  /** A library's row: its shows for a TV shows library, its videos for any other. */
  private shelf({
    library: { id, settings },
    search,
    sort,
    limit,
    account,
  }: HomeControllerShelfProps): HomeShelf {
    const listing = { libraryId: id, search, sort, limit, account }
    return listsShows(settings.kind)
      ? { libraryId: id, type: 'shows', shows: this.media.listShows(listing) }
      : { libraryId: id, type: 'media', media: this.media.list(listing) }
  }

  /**
   * The libraries home shows `viewer`, as the side menu orders them. A locked
   * library is never one, for anyone, even once the PIN has opened it.
   */
  private onHome(viewer: Viewer): LibraryRecord[] {
    return this.libraries
      .list()
      .filter((library) => !library.settings.locked && viewer.seesLibrary(library.id))
  }

  /** Every video in progress with the poster its card shows, then each pinned library's newest releases. */
  @Get()
  home(@Req() request: FastifyRequest): Home {
    const account = this.accounts.keyOf({ request })
    const libraries = this.onHome(this.lock.viewer({ request }))
    const shown = new Set(libraries.map(({ id }) => id))
    return {
      inProgress: this.media.withPosters(
        this.media.listInProgress({ account }).filter(({ libraryId }) => shown.has(libraryId)),
      ),
      shelves: libraries
        .filter((library) => library.settings.pinned)
        .map((library) =>
          this.shelf({
            library,
            search: '',
            sort: MEDIA_SORTS.yearNew,
            limit: SHELF_SIZE,
            account,
          }),
        ),
    }
  }

  /**
   * A shelf of albums for each pinned music library, the newest release
   * first, read apart from the shelves.
   */
  @Get('albums')
  albums(@Req() request: FastifyRequest): AlbumShelf[] {
    const account = this.accounts.keyOf({ request })
    return this.onHome(this.lock.viewer({ request }))
      .filter(
        (library) =>
          library.settings.pinned && listingFor(library.settings.kind) === LIBRARY_LISTINGS.albums,
      )
      .map((library) => ({
        libraryId: library.id,
        albums: this.music
          .listAlbums({
            libraryId: library.id,
            search: '',
            sort: MUSIC_SORTS.release,
            order: SORT_DIRECTIONS.descending,
            account,
          })
          .slice(0, SHELF_SIZE),
      }))
  }

  /**
   * The titles home's hero takes turns with, read apart from the shelves so
   * neither waits for the other; libraries still locked stay out.
   */
  @Get('hero')
  heroEntries(@Req() request: FastifyRequest): Hero {
    return this.hero.entries({
      viewer: this.lock.viewer({ request }),
      account: this.accounts.keyOf({ request }),
    })
  }

  /**
   * What `?q=` finds in every library, pinned or not, by title: a row for
   * each library holding a match, and nothing for a blank search. Locked
   * libraries stay out, whether or not the PIN is entered.
   */
  @Get('search')
  search(@Query('q') q: unknown, @Req() request: FastifyRequest): HomeSearch {
    const search = isString(q) ? q.trim() : ''
    if (!search) return []
    const account = this.accounts.keyOf({ request })
    return this.libraries
      .list()
      .filter((library) => !library.settings.locked)
      .map((library) =>
        this.shelf({ library, search, sort: MEDIA_SORTS.title, limit: SEARCH_SHELF_SIZE, account }),
      )
      .filter(
        (shelf) => (shelf.type === HOME_SHELF_TYPES.shows ? shelf.shows : shelf.media).length > 0,
      )
  }
}
