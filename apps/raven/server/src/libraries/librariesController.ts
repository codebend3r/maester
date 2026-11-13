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
  Req,
} from '@nestjs/common'
import {
  isLibraryHeroChange,
  isLibraryOrder,
  isLibraryViewChange,
  type Library,
  type LibraryInput,
  validateLibraryInput,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { Management } from '@/auth/management'
import { type LibraryRecord, LibrariesRepository, samePaths } from '@/libraries/librariesRepository'
import { LibraryById } from '@/libraries/libraryById'
import { LibraryViews } from '@/libraries/libraryViews'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { LockService, PRIVACIES } from '@/lock/lockService'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { MediaIndex } from '@/media/mediaIndex'
import { MetadataService } from '@/metadata/metadataService'
import { parseBody } from '@/parseBody'
import { ROUTE_PARAMS } from '@/requestParts'
import { LibraryWatcher } from '@/scanner/libraryWatcher'
import { ScannerService } from '@/scanner/scannerService'

const parseInput = (body: unknown): LibraryInput => {
  const result = validateLibraryInput(body)
  if (!result.ok) throw new BadRequestException(result.errors)
  return result.value
}

type LibrariesControllerSaveSettingsProps = {
  library: LibraryRecord
  settings: LibraryInput['settings']
  request: FastifyRequest
}

/** The libraries themselves: listing them, and creating, changing, ordering and deleting one. */
@Controller('api/libraries')
@PrivateBy(PRIVACIES.library)
export class LibrariesController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(LibraryViews) private readonly views: LibraryViews,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(MediaArtifacts) private readonly artifacts: MediaArtifacts,
    @Inject(ScannerService) private readonly scanner: ScannerService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(LibraryWatcher) private readonly watcher: LibraryWatcher,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(Management) private readonly management: Management,
  ) {}

  /** A library can only be locked behind a PIN that can open it again. */
  private parseLockable(body: unknown): LibraryInput {
    const input = parseInput(body)
    if (input.settings?.locked && !this.lock.available) {
      throw new BadRequestException("Set LIBRARY_PIN in raven's .env to lock a library.")
    }
    return input
  }

  /** Saves settings that no scan, match or watcher reads, answered as the caller sees the library. */
  private saveSettings({
    library,
    settings,
    request,
  }: LibrariesControllerSaveSettingsProps): Library {
    const { id, name, paths } = library
    const record = this.libraries.update({ id, input: { name, paths, settings } })
    if (!record) throw new NotFoundException(`No library ${id}`)
    return this.views.withStatus({
      record,
      canSee: true,
      isAdmin: this.management.canManage({ request }),
    })
  }

  /** Every library, but a locked one the viewer may not see: all of them unless the caller can manage. */
  @Public()
  @Get()
  list(@Req() request: FastifyRequest): Library[] {
    const viewer = this.lock.viewer({ request })
    return this.libraries
      .list()
      .filter((record) => viewer.listsLibrary(record.id))
      .map((record) =>
        this.views.withStatus({
          record,
          canSee: viewer.seesLibrary(record.id),
          isAdmin: this.management.canManage({ request }),
        }),
      )
  }

  /**
   * Every library shows in the side menu, locked or not, so its own settings
   * do too; to a caller who cannot manage, a locked one is not there at all.
   */
  @Public()
  @Get(':id')
  get(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @Req() request: FastifyRequest,
  ): Library {
    const viewer = this.lock.viewer({ request })
    if (!viewer.listsLibrary(library.id)) throw new NotFoundException(`No library ${library.id}`)
    return this.views.withStatus({
      record: library,
      canSee: viewer.seesLibrary(library.id),
      isAdmin: this.management.canManage({ request }),
    })
  }

  /** Creating a library starts its first scan; the response already reports it as scanning. */
  @Public()
  @AdminOnly()
  @Post()
  create(@Body() body: unknown): Library {
    const record = this.libraries.create(this.parseLockable(body))
    this.scanner.scan(record.id)
    this.watcher.sync()
    return this.views.managed(record)
  }

  /**
   * Only a change of folders rescans. Matching reads the library again as far
   * as its settings changed (`MetadataService.settingsChanged`).
   */
  @AdminOnly()
  @Put(':id')
  update(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) before: LibraryRecord,
    @Body() body: unknown,
  ): Library {
    const { id } = before
    const input = this.parseLockable(body)
    const record = this.libraries.update({ id, input })
    if (!record) throw new NotFoundException(`No library ${id}`)
    this.metadata.settingsChanged({
      libraryId: id,
      before: before.settings,
      after: record.settings,
    })
    if (!samePaths({ before: before.paths, after: record.paths })) this.scanner.scan(id)
    this.watcher.sync()
    return this.views.managed(record)
  }

  /**
   * How a library is sorted, viewed and grouped, and its pin, which anyone
   * watching may change. None of them is read by a scan, a match or the
   * watcher, so nothing runs again.
   */
  @ForViewers()
  @Put(':id/view')
  setView(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Library {
    const settings = parseBody({
      guard: isLibraryViewChange,
      body,
      message: 'Send only sort, view, groupBy or pinned, each a value it takes.',
    })
    return this.saveSettings({ library, settings, request })
  }

  /** Lists the libraries in the admin's order: `ids` names every library once. */
  @Public()
  @AdminOnly()
  @Put('order')
  @HttpCode(204)
  reorder(@Body() body: unknown): void {
    const { ids } = parseBody({
      guard: isLibraryOrder,
      body,
      message: 'ids must name every library once.',
    })
    if (!this.libraries.reorder(ids)) {
      throw new BadRequestException('ids must name every library once.')
    }
  }

  /** Includes the library's titles in home's hero, or leaves them out. */
  @AdminOnly()
  @Put(':id/hero')
  setInHero(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Library {
    const settings = parseBody({
      guard: isLibraryHeroChange,
      body,
      message: 'inHero must be true or false.',
    })
    if (settings.inHero && library.settings.locked) {
      throw new BadRequestException('A locked library can never show in the hero.')
    }
    return this.saveSettings({ library, settings, request })
  }

  @AdminOnly()
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param(ROUTE_PARAMS.id, ParseIntPipe, LibraryById) library: LibraryRecord,
  ): Promise<void> {
    const { id } = library
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
}
