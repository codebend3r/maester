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
} from '@nestjs/common'
import {
  type HistoryEntry,
  type Library,
  type LibraryInput,
  type MediaItem,
  type MediaSort,
  type ShowListing,
  isMediaSort,
  validateLibraryInput,
} from '@raven/core'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaRepository, toMediaItem } from '@/media/mediaRepository'
import { MetadataService } from '@/metadata/metadataService'
import { SubtitlesService } from '@/playback/subtitlesService'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const parseInput = (body: unknown): LibraryInput => {
  const result = validateLibraryInput(body)
  if (!result.ok) throw new BadRequestException(result.errors)
  return result.value
}

/** How many history entries a request gets unless it asks, and the most it may ask for. */
const HISTORY_LIMIT = { fallback: 100, most: 500 }

const historyLimit = (asked: string | undefined): number => {
  const limit = Number.parseInt(asked ?? '', 10)
  return Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), HISTORY_LIMIT.most)
    : HISTORY_LIMIT.fallback
}

const samePaths = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((path, index) => path === b[index])

@Controller('api/libraries')
export class LibrariesController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(ScannerService) private readonly scanner: ScannerService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  private withStatus(record: LibraryRecord): Library {
    return { ...record, scan: this.scanner.status(record.id) }
  }

  private find(id: number): LibraryRecord {
    const record = this.libraries.get(id)
    if (!record) throw new NotFoundException(`No library ${id}`)
    return record
  }

  @Get()
  list(): Library[] {
    return this.libraries.list().map((record) => this.withStatus(record))
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Library {
    return this.withStatus(this.find(id))
  }

  /** Creating a library starts its first scan; the response already reports it as scanning. */
  @Post()
  create(@Body() body: unknown): Library {
    const record = this.libraries.create(parseInput(body))
    this.scanner.scan(record.id)
    return this.withStatus(record)
  }

  /**
   * Only a change of folders rescans, and only a change of type matches the
   * files again; a rename or another setting leaves the index as it is.
   */
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Library {
    const input = parseInput(body)
    const before = this.find(id)
    const record = this.libraries.update({ id, input })
    if (!record) throw new NotFoundException(`No library ${id}`)
    if (before.settings.kind !== record.settings.kind) {
      this.metadata.changeKind({ libraryId: id, kind: record.settings.kind })
    }
    if (!samePaths(before.paths, record.paths)) this.scanner.scan(id)
    return this.withStatus(record)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    this.find(id)
    await this.scanner.whenIdle(id)
    const ids = this.media.idsForLibrary(id)
    await this.thumbnails.discard(ids)
    await this.subtitles.discard(ids)
    this.libraries.remove(id)
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

  /** The library's played videos, last played first; `watched=true` keeps the ones watched. */
  @Get(':id/history')
  history(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('watched') watched?: string,
  ): HistoryEntry[] {
    this.find(id)
    return this.media
      .history({ libraryId: id, limit: historyLimit(limit), watchedOnly: watched === 'true' })
      .map((entry) => ({
        media: toMediaItem(entry.record),
        lastPlayedAt: entry.lastPlayedAt,
        plays: entry.plays,
        furthest: entry.furthest,
        watched: entry.watched,
      }))
  }

  /** A TV shows library as its shows, with the files no show was found for after. */
  @Get(':id/shows')
  listShows(
    @Param('id', ParseIntPipe) id: number,
    @Query('q') search?: string,
    @Query('sort') sort?: string,
    @Query('seed') seed?: string,
  ): ShowListing {
    this.find(id)
    const order: MediaSort = isMediaSort(sort) ? sort : 'title'
    const dealt = Number.parseInt(seed ?? '', 10)
    const shows = this.media
      .listShows({
        libraryId: id,
        search: search ?? '',
        sort: order,
        seed: Number.isInteger(dealt) ? dealt : 0,
      })
      .map((entry) => ({ ...entry, next: entry.next ? toMediaItem(entry.next) : null }))
    return {
      shows,
      unmatched: this.media.listUnmatched({ libraryId: id, search: search ?? '' }).map(toMediaItem),
    }
  }

  @Get(':id/media')
  listMedia(
    @Param('id', ParseIntPipe) id: number,
    @Query('q') search?: string,
    @Query('sort') sort?: string,
    @Query('seed') seed?: string,
  ): MediaItem[] {
    this.find(id)
    const order: MediaSort = isMediaSort(sort) ? sort : 'title'
    const dealt = Number.parseInt(seed ?? '', 10)
    return this.media
      .list({
        libraryId: id,
        search: search ?? '',
        sort: order,
        seed: Number.isInteger(dealt) ? dealt : 0,
      })
      .map(toMediaItem)
  }
}
