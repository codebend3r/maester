import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common'
import {
  type DolbyVisionOnlyListing,
  type Duplicates,
  SAGA_BACKDROP_TYPES,
  type SagaBackdrop,
  isJoinRequest,
  isSagaBackdrop,
  isSplitRequest,
  sagaPictures,
} from '@raven/core'
import { AdminOnly } from '@/admin/adminGuard'
import type { LibraryRecord } from '@/libraries/librariesRepository'
import { LibraryById } from '@/libraries/libraryById'
import { LibraryViews, isMovieLibrary } from '@/libraries/libraryViews'
import { PrivateBy } from '@/lock/lockGuard'
import { PRIVACIES } from '@/lock/lockService'
import { DolbyVisionOnly } from '@/media/dolbyVisionOnly'
import { MovieSplits } from '@/media/movieSplits'
import { SagaBackdrops } from '@/media/sagaBackdrops'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingAccount } from '@/media/viewingAccountParam'
import { parseBody } from '@/parseBody'
import { ROUTE_PARAMS } from '@/requestParts'
import { LIBRARY_ROUTES } from '@/libraries/libraryRoutes'

/** The route parameter naming a saga by its TMDB id. */
const SAGA_PARAM = 'sagaId'

/** A library matched to movies; the others keep each file on its own card, with nothing to split. */
const requireMovies = (library: LibraryRecord): void => {
  if (!isMovieLibrary(library)) {
    throw new BadRequestException('Only a library of movies has duplicates to split.')
  }
}

/** Tidying a library: its sagas' backdrops, its Dolby Vision only files, and its duplicate movies. */
@Controller(LIBRARY_ROUTES)
@PrivateBy(PRIVACIES.library)
export class LibraryCurationController {
  constructor(
    @Inject(LibraryViews) private readonly views: LibraryViews,
    @Inject(MovieSplits) private readonly splits: MovieSplits,
    @Inject(DolbyVisionOnly) private readonly dolbyVisionOnly: DolbyVisionOnly,
    @Inject(SagaBackdrops) private readonly sagaBackdrops: SagaBackdrops,
  ) {}

  /**
   * Picks what a saga's page shows behind its title: its movies' backdrops
   * in turn, or one of them held still, which must be one it has.
   */
  @AdminOnly()
  @Put(`:id/sagas/:${SAGA_PARAM}/backdrop`)
  setSagaBackdrop(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @Param(SAGA_PARAM) sagaId: string,
    @Body() body: unknown,
    @ViewingAccount() account: AccountKey,
  ): SagaBackdrop {
    const saga = this.views
      .sagasOf({ record: library, account })
      .find((each) => each.tmdbId === sagaId)
    if (!saga) throw new NotFoundException(`No saga ${sagaId} in library ${library.id}`)
    const backdrop = parseBody({
      guard: isSagaBackdrop,
      body,
      message: 'Send a slideshow and its motion, or the movie whose backdrop to hold still.',
    })
    const isOwnPicture =
      backdrop.type === SAGA_BACKDROP_TYPES.slideshow ||
      sagaPictures(saga).some((picture) => picture.id === backdrop.itemId)
    if (!isOwnPicture) throw new BadRequestException(`${saga.name} has no such backdrop.`)
    this.sagaBackdrops.save({ libraryId: library.id, sagaId, backdrop })
    return backdrop
  }

  /** What in it is Dolby Vision profile 5: its shows with how many episodes are, and its other such files. */
  @Get(':id/dolby-vision')
  listDolbyVisionOnly(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): DolbyVisionOnlyListing {
    return this.dolbyVisionOnly.list({ libraryId: library.id, account })
  }

  /** Its movies with more than one file, split apart or not; none in a library not matched to movies. */
  @Get(':id/duplicates')
  listDuplicates(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @ViewingAccount() account: AccountKey,
  ): Duplicates {
    return isMovieLibrary(library) ? this.splits.list({ libraryId: library.id, account }) : []
  }

  /** Splits a card, named by any file on it: every file apart, or by cut. */
  @AdminOnly()
  @Post(':id/duplicates/split')
  @HttpCode(200)
  split(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @Body() body: unknown,
    @ViewingAccount() account: AccountKey,
  ): Duplicates {
    requireMovies(library)
    const asked = parseBody({
      guard: isSplitRequest,
      body,
      message: 'Send { mediaId, how }, how being "apart" or "smart".',
    })
    return this.splits.split({ libraryId: library.id, ...asked, account })
  }

  /** Puts a split movie's files back on one card. */
  @AdminOnly()
  @Post(':id/duplicates/join')
  @HttpCode(200)
  join(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @Body() body: unknown,
    @ViewingAccount() account: AccountKey,
  ): Duplicates {
    requireMovies(library)
    const { itemId } = parseBody({ guard: isJoinRequest, body, message: 'Send { itemId }.' })
    return this.splits.join({ libraryId: library.id, itemId, account })
  }
}
