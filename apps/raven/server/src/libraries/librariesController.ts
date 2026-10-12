import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type HistoryEntry,
  type Library,
  type LibraryInput,
  type MediaItem,
  type MediaListParams,
  type ShowListing,
  isRecord,
  matchTypeFor,
  mediaListQuery,
  validateLibraryInput,
} from '@raven/core'
import { type LibraryRecord, LibrariesRepository, samePaths } from '@/libraries/librariesRepository'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { ViewingRepository } from '@/media/viewingRepository'
import { MetadataService } from '@/metadata/metadataService'
import { LibraryWatcher } from '@/scanner/libraryWatcher'
import { ScannerService } from '@/scanner/scannerService'

const parseInput = (body: unknown): LibraryInput => {
  const result = validateLibraryInput(body)
  if (!result.ok) throw new BadRequestException(result.errors)
  return result.value
}

/** A listing's search, sort and seed, read as the client's `mediaListQuery.encode` wrote them. */
const listParams = (query: unknown): MediaListParams =>
  mediaListQuery.decode(isRecord(query) ? query : {})

/** How many history entries a request gets unless it asks, and the most it may ask for. */
const HISTORY_LIMIT = { fallback: 100, most: 500 }

const historyLimit = (asked: string | undefined): number => {
  const limit = Number.parseInt(asked ?? '', 10)
  return Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), HISTORY_LIMIT.most)
    : HISTORY_LIMIT.fallback
}

@Controller('api/libraries')
@PrivateBy('library')
export class LibrariesController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(ViewingRepository) private readonly viewing: ViewingRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(MediaArtifacts) private readonly artifacts: MediaArtifacts,
    @Inject(ScannerService) private readonly scanner: ScannerService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(LibraryWatcher) private readonly watcher: LibraryWatcher,
    @Inject(LockService) private readonly lock: LockService,
  ) {}

  /** A library can only be locked behind a PIN that can open it again. */
  private parseLockable(body: unknown): LibraryInput {
    const input = parseInput(body)
    if (input.settings?.locked && !this.lock.available) {
      throw new BadRequestException("Set LIBRARY_PIN in raven's .env to lock a library.")
    }
    return input
  }

  private withStatus(record: LibraryRecord): Library {
    return { ...record, scan: this.scanner.status(record.id) }
  }

  private find(id: number): LibraryRecord {
    const record = this.libraries.get(id)
    if (!record) throw new NotFoundException(`No library ${id}`)
    return record
  }

  @Public()
  @Get()
  list(): Library[] {
    return this.libraries.list().map((record) => this.withStatus(record))
  }

  /** Every library shows in the side menu, locked or not, so its own settings do too. */
  @Public()
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Library {
    return this.withStatus(this.find(id))
  }

  /** Creating a library starts its first scan; the response already reports it as scanning. */
  @Public()
  @Post()
  create(@Body() body: unknown): Library {
    const record = this.libraries.create(this.parseLockable(body))
    this.scanner.scan(record.id)
    this.watcher.sync()
    return this.withStatus(record)
  }

  /**
   * Only a change of folders rescans, and only a change of type that reads
   * files another way matches them again: Movies to Anime movies keeps every
   * match. A rename or another setting, the lock included, leaves the index
   * as it is.
   */
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Library {
    const input = this.parseLockable(body)
    const before = this.find(id)
    const record = this.libraries.update({ id, input })
    if (!record) throw new NotFoundException(`No library ${id}`)
    if (matchTypeFor(before.settings.kind) !== matchTypeFor(record.settings.kind)) {
      this.metadata.changeKind({ libraryId: id, kind: record.settings.kind })
    }
    if (!samePaths({ before: before.paths, after: record.paths })) this.scanner.scan(id)
    this.watcher.sync()
    return this.withStatus(record)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    this.find(id)
    await this.scanner.whenIdle(id)
    const ids = this.index.idsForLibrary(id)
    // Its videos' rows go with it; what was kept of them goes after.
    this.libraries.remove(id)
    await this.artifacts.discard(ids)
    this.watcher.sync()
    this.scanner.forget(id)
    // The pass finds no library, and clears up the items it left.
    this.metadata.enqueue(id)
  }

  @Post(':id/scan')
  @HttpCode(200)
  scan(@Param('id', ParseIntPipe) id: number): Library {
    const record = this.find(id)
    this.scanner.scan(id)
    return this.withStatus(record)
  }

  /**
   * Match again: the files no movie or show was found for go back in the
   * queue, and TMDB is searched for them once more. Fix match choices stay.
   */
  @Post(':id/match')
  @HttpCode(200)
  rematch(@Param('id', ParseIntPipe) id: number): Library {
    const record = this.find(id)
    if (matchTypeFor(record.settings.kind) == null) {
      throw new BadRequestException('Only a library of movies or shows is matched.')
    }
    if (this.metadata.health().tmdb === 'off') {
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to match files.')
    }
    this.metadata.retryUnmatched(id)
    // Read again, so the count of files not matched is the one after the retry.
    return this.withStatus(this.find(id))
  }

  /** The library's played videos, last played first; `watched=true` keeps the ones watched. */
  @Get(':id/history')
  history(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('watched') watched?: string,
  ): HistoryEntry[] {
    this.find(id)
    return this.viewing.history({
      libraryId: id,
      limit: historyLimit(limit),
      watchedOnly: watched === 'true',
    })
  }

  /** A TV shows library as its shows, with the files no show was found for after. */
  @Get(':id/shows')
  listShows(@Param('id', ParseIntPipe) id: number, @Query() query: unknown): ShowListing {
    this.find(id)
    const params = listParams(query)
    return {
      shows: this.media.listShows({ libraryId: id, ...params }),
      unmatched: this.media.listUnmatched({ libraryId: id, search: params.search }),
    }
  }

  @Get(':id/media')
  listMedia(@Param('id', ParseIntPipe) id: number, @Query() query: unknown): MediaItem[] {
    this.find(id)
    return this.media.list({ libraryId: id, ...listParams(query) })
  }
}
