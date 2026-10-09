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
  type Library,
  type LibraryInput,
  type MediaItem,
  type MediaSort,
  validateLibraryInput,
} from '@raven/core'
import { type LibraryRecord, LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaRepository, toMediaItem } from '@/media/mediaRepository'
import { SubtitlesService } from '@/playback/subtitlesService'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

const parseInput = (body: unknown): LibraryInput => {
  const result = validateLibraryInput(body)
  if (!result.ok) throw new BadRequestException(result.errors)
  return result.value
}

@Controller('api/libraries')
export class LibrariesController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(ScannerService) private readonly scanner: ScannerService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(SubtitlesService) private readonly subtitles: SubtitlesService,
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

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Library {
    const record = this.libraries.update({ id, input: parseInput(body) })
    if (!record) throw new NotFoundException(`No library ${id}`)
    this.scanner.scan(id)
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
  }

  @Post(':id/scan')
  @HttpCode(200)
  scan(@Param('id', ParseIntPipe) id: number): Library {
    const record = this.find(id)
    this.scanner.scan(id)
    return this.withStatus(record)
  }

  @Get(':id/media')
  listMedia(
    @Param('id', ParseIntPipe) id: number,
    @Query('q') search?: string,
    @Query('sort') sort?: string,
  ): MediaItem[] {
    this.find(id)
    const order: MediaSort = sort === 'added' ? 'added' : 'title'
    return this.media.list({ libraryId: id, search: search ?? '', sort: order }).map(toMediaItem)
  }
}
