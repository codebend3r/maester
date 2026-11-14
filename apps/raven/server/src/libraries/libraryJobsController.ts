import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type AlbumMerge,
  type Library,
  MATCH_SOURCES,
  METADATA_SERVICE_STATES,
  type SmartMatchStarted,
  isMusicLibrary,
  matcherFor,
} from '@raven/core'
import { AdminOnly } from '@/admin/adminGuard'
import { ServerEvents } from '@/events/serverEvents'
import type { LibraryRecord } from '@/libraries/librariesRepository'
import { LibraryById } from '@/libraries/libraryById'
import { LibraryViews } from '@/libraries/libraryViews'
import { RatingsRefresh } from '@/libraries/ratingsRefresh'
import { PrivateBy } from '@/lock/lockGuard'
import { PRIVACIES } from '@/lock/lockService'
import { MarkerDetection } from '@/markers/markerDetection'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingAccount } from '@/media/viewingAccountParam'
import { MetadataService } from '@/metadata/metadataService'
import { MusicMatchStore } from '@/music/musicMatchStore'
import { SmartMatch } from '@/music/smartMatch'
import { ROUTE_PARAMS } from '@/requestParts'
import { QUEUE_KEYS, queueKeyOf } from '@/scanner/concurrency'
import { ScannerService } from '@/scanner/scannerService'
import { LIBRARY_ROUTES } from '@/libraries/libraryRoutes'

type LibraryJobsControllerCommandedProps = { library: LibraryRecord; act: (id: number) => void }

/** What an admin starts or stops on a library: scans, ratings, intros, matching and album clean-ups. */
@Controller(LIBRARY_ROUTES)
@PrivateBy(PRIVACIES.library)
export class LibraryJobsController {
  constructor(
    @Inject(LibraryViews) private readonly views: LibraryViews,
    @Inject(ScannerService) private readonly scanner: ScannerService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(RatingsRefresh) private readonly ratings: RatingsRefresh,
    @Inject(MarkerDetection) private readonly markers: MarkerDetection,
    @Inject(MusicMatchStore) private readonly matches: MusicMatchStore,
    @Inject(ServerEvents) private readonly events: ServerEvents,
    @Inject(SmartMatch) private readonly smartMatch: SmartMatch,
  ) {}

  /** An admin's command on a library: `act` runs on it, and the answer is the library as the admin sees it. */
  private commanded({ library, act }: LibraryJobsControllerCommandedProps): Library {
    act(library.id)
    return this.views.managed(library)
  }

  @AdminOnly()
  @Post(':id/markers')
  @HttpCode(200)
  scanMarkers(@Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord): Library {
    return this.commanded({
      library,
      act: (libraryId) => {
        if (!this.markers.scanLibrary(libraryId)) {
          throw new ServiceUnavailableException(
            'Scans are stopped or marker detection is disabled on this server.',
          )
        }
      },
    })
  }

  /** Cancels a full scan, or any scan running: it stops at its next step. */
  @AdminOnly()
  @Post(':id/scan/cancel')
  @HttpCode(200)
  cancelScan(@Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord): Library {
    return this.commanded({ library, act: (libraryId) => this.scanner.cancel(libraryId) })
  }

  @AdminOnly()
  @Post(':id/scan')
  @HttpCode(200)
  scan(@Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord): Library {
    return this.commanded({ library, act: (libraryId) => this.scanner.scan(libraryId) })
  }

  /**
   * A quick scan: only what is new in the library's folders is read and
   * added, and the scores of the titles it added are fetched once they are
   * matched. Pressed while one runs, it changes nothing.
   */
  @AdminOnly()
  @Post(':id/quick-scan')
  @HttpCode(200)
  quickScan(@Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord): Library {
    return this.commanded({ library, act: (libraryId) => this.ratings.quickScan(libraryId) })
  }

  /** Cancels a quick scan, and the scores that would follow it. */
  @AdminOnly()
  @Post(':id/quick-scan/cancel')
  @HttpCode(200)
  cancelQuickScan(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
  ): Library {
    return this.commanded({ library, act: (libraryId) => this.ratings.cancelQuickScan(libraryId) })
  }

  /**
   * Update ratings: every movie and show in the library with no rating from
   * the source it shows has its scores fetched. Pressed while one runs, it
   * adds whatever has no rating since.
   */
  @AdminOnly()
  @Post(':id/ratings')
  @HttpCode(200)
  updateRatings(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
  ): Library {
    return this.commanded({ library, act: (libraryId) => this.ratings.start({ libraryId }) })
  }

  /** Cancels Update ratings: the titles still waiting are not asked for. */
  @AdminOnly()
  @Post(':id/ratings/cancel')
  @HttpCode(200)
  cancelRatings(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
  ): Library {
    return this.commanded({ library, act: (libraryId) => this.ratings.cancel(libraryId) })
  }

  /**
   * Looks through a music library and folds every album that is the same
   * release as another into one: the same MusicBrainz release, or the same
   * title, year and track count under an artist in common. Fix match choices stay.
   */
  @AdminOnly()
  @Post(':id/albums/merge')
  @HttpCode(200)
  mergeAlbums(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
  ): AlbumMerge {
    if (!isMusicLibrary(library)) {
      throw new BadRequestException('Only a library of music has albums to merge.')
    }
    const merged = this.matches.mergeAlbums(library.id)
    if (merged > 0) this.events.libraryChanged(library.id)
    return { merged }
  }

  /**
   * Smart match, in the background: the library's unmatched albums whose
   * tracks belong to another album by their folder are folded into it, and
   * the rest searched again harder. The caller's account is told of each
   * outcome as a notification. How many albums it looks at.
   */
  @AdminOnly()
  @Post(':id/albums/smart-match')
  @HttpCode(200)
  smartMatchAlbums(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): SmartMatchStarted {
    if (!isMusicLibrary(library)) {
      throw new BadRequestException('Only a library of music has albums to match.')
    }
    const { id } = library
    // Counted first: the queue may start the match at once, which puts the albums back to pending.
    const albums = this.matches.unmatchedCount(id)
    this.metadata.schedule({
      key: queueKeyOf({ kind: QUEUE_KEYS.smartMatch, parts: [id] }),
      task: () => this.smartMatch.run({ libraryId: id, account }),
    })
    return { albums }
  }

  /**
   * Match again: the files no movie or show was found for go back in the
   * queue, and TMDB is searched for them once more. Fix match choices stay.
   */
  @AdminOnly()
  @Post(':id/match')
  @HttpCode(200)
  rematch(@Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord): Library {
    const matcher = matcherFor(library.settings.kind)
    if (matcher === null) {
      throw new BadRequestException('Only a library of movies, shows or music is matched.')
    }
    if (
      matcher.by === MATCH_SOURCES.tmdb &&
      this.metadata.health().tmdb === METADATA_SERVICE_STATES.off
    ) {
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to match files.')
    }
    this.metadata.retryUnmatched(library.id)
    // Read again, so the count of files not matched is the one after the retry.
    return this.views.managed(this.views.find(library.id))
  }
}
