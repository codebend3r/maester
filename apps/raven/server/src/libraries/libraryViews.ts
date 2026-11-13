import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ITEM_TYPES, type Library, type Saga, matchTypeFor } from '@raven/core'
import { Management } from '@/auth/management'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import { RatingsRefresh } from '@/libraries/ratingsRefresh'
import { MediaRepository } from '@/media/mediaRepository'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ScannerService } from '@/scanner/scannerService'

/** A locked library's scan failure, in place of the message, which names its folders. */
export const LOCKED_SCAN_ERROR = 'The last scan ran into trouble. Enter the PIN to see what.'

/** A scan's failure for a viewer the admin lock holds, so who may not see the folders it names. */
export const HIDDEN_SCAN_ERROR =
  'The last scan ran into trouble. Turn the admin lock off in Admin to see what.'

/** A scan's failure for a member once accounts are on: only the owner sees the folders it names. */
export const OWNER_SCAN_ERROR = 'The last scan ran into trouble. Only the owner can see what.'

/** Whether the library's files are matched to movies: only such a library has sagas and duplicates. */
export const isMovieLibrary = (record: LibraryRecord): boolean =>
  matchTypeFor(record.settings.kind) === ITEM_TYPES.movie

type LibraryViewsWithStatusProps = {
  record: LibraryRecord
  canSee: boolean
  isAdmin: boolean
}

type LibraryViewsSagasOfProps = { record: LibraryRecord; account: AccountKey }

/** A library as each of the library controllers answers it. */
@Injectable()
export class LibraryViews {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(ScannerService) private readonly scanner: ScannerService,
    @Inject(RatingsRefresh) private readonly ratings: RatingsRefresh,
    @Inject(Management) private readonly management: Management,
  ) {}

  /**
   * A library as a client sees it: its scan's live status, where its
   * Refresh stands, and its newest video's picture. Without `canSee` a
   * library still locked to the caller keeps its folders, its picture and
   * what its last scan said about them (which names the folders) to itself,
   * and shows only its name, type, counts and Refresh. Without `isAdmin`,
   * which is whoever may manage raven, no library shows its
   * folders or the scan failure that names them. Every route says which:
   * the public ones ask the lock, while the guarded ones, and creating a
   * library, pass true, as whoever reaches them sees it all.
   */
  withStatus({ record, canSee, isAdmin }: LibraryViewsWithStatusProps): Library {
    const scan = this.scanner.status(record.id)
    const ratingsRefresh = this.ratings.status(record.id)
    if (canSee && isAdmin) {
      return { ...record, scan, ratingsRefresh, backdrop: this.media.backdropOf(record.id) }
    }
    const unmanagedError = this.management.isLegacy() ? HIDDEN_SCAN_ERROR : OWNER_SCAN_ERROR
    const hiddenError = canSee ? unmanagedError : LOCKED_SCAN_ERROR
    return {
      ...record,
      paths: [],
      layouts: [],
      scan: { ...scan, error: scan.error == null ? null : hiddenError },
      ratingsRefresh,
      backdrop: canSee ? this.media.backdropOf(record.id) : null,
    }
  }

  /** A library as whoever may manage raven sees it: folders, picture and scan failure included. */
  managed(record: LibraryRecord): Library {
    return this.withStatus({ record, canSee: true, isAdmin: true })
  }

  /** The library as it is now, a 404 once it is gone: a route's `:id` (`LibraryById`), or one a route changed. */
  find(id: number): LibraryRecord {
    const record = this.libraries.get(id)
    if (!record) throw new NotFoundException(`No library ${id}`)
    return record
  }

  /** Its sagas of two movies or more; none in a library that is not matched to movies. */
  sagasOf({ record, account }: LibraryViewsSagasOfProps): Saga[] {
    return isMovieLibrary(record) ? this.media.listSagas({ libraryId: record.id, account }) : []
  }
}
