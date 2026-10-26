import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Req,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type ChoosableImageKind,
  IMAGE_SOURCES,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  type ImageOption,
  isFavouriteChange,
  isImageChoice,
  isItemImageKind,
  isItemMetadataChange,
  isMatchItemType,
  isShowMatchChoice,
  type ItemDetails,
  type ItemImageOptions,
  type ItemMetadataState,
  type MediaItem,
} from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { isChoosableImageKind } from '@/items/imageKinds'
import { itemChildren } from '@/items/itemChildren'
import { ItemPictureFiles, pictureWidth } from '@/items/itemPictureFiles'
import { sendImage } from '@/items/sendImage'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { PrivateBy } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { FAVOURITE_OUTCOMES } from '@/media/favouriteOutcomes'
import { MediaRepository } from '@/media/mediaRepository'
import { TitleFavourites } from '@/media/titleFavourites'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { IMAGE_WIDTHS, ImageCache } from '@/metadata/imageCache'
import { ItemImagesRepository, STORED_IMAGE_SOURCES } from '@/metadata/itemImagesRepository'
import { ItemOverrides } from '@/metadata/itemOverrides'
import { ItemRefresher } from '@/metadata/itemRefresher'
import { isLocal } from '@/metadata/localItems'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { TMDB_IMAGE_PATH, TmdbClient, TmdbError } from '@/metadata/tmdbClient'
import { ROUTE_PARAMS } from '@/requestParts'

type ItemsControllerDetailsProps = { id: number; request: FastifyRequest }

/** Movies, shows, seasons and episodes: their pages, their pictures, and fetching them again. */
@Controller('api/items')
@PrivateBy('item')
export class ItemsController {
  constructor(
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MetadataService) private readonly service: MetadataService,
    @Inject(ItemRefresher) private readonly refresher: ItemRefresher,
    @Inject(ItemOverrides) private readonly overrides: ItemOverrides,
    @Inject(ImageCache) private readonly images: ImageCache,
    @Inject(ItemImagesRepository) private readonly stored: ItemImagesRepository,
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(TitleFavourites) private readonly titleFavourites: TitleFavourites,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(ItemPictureFiles) private readonly pictureFiles: ItemPictureFiles,
  ) {}

  private requireItem(id: number): void {
    if (!this.metadata.get(id)) throw new NotFoundException(`No item ${id}`)
  }

  /** The item's page, with only the files, children and AI note this caller may see. */
  private details({ id, request }: ItemsControllerDetailsProps): ItemDetails {
    const details = this.metadata.details(id)
    if (!details) throw new NotFoundException(`No item ${id}`)
    const viewer = this.lock.viewer({ request })
    const account = this.accounts.keyOf({ request })
    return {
      ...details,
      aiMatch: this.service.aiMatchFor({
        id,
        type: details.type,
        tmdbId: details.tmdbId,
        sees: (libraryId) => viewer.seesLibrary(libraryId),
      }),
      favourite: this.titleFavourites.favouriteOf({ itemId: id, account }),
      versions: this.media
        .forItem({ itemId: id, account })
        .filter((item) => viewer.seesLibrary(item.libraryId)),
      children: itemChildren({
        parentId: id,
        viewer,
        metadata: this.metadata,
        media: this.media,
        account,
      }),
    }
  }

  /**
   * Fix match for a show: every file under it moves to the show with
   * `tmdbId`, keeping its season and episode numbers, and the choice is
   * kept by folder. Answers with the show the files moved to.
   */
  @AdminOnly()
  @Put(':id/match')
  async setMatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ItemDetails> {
    const item = this.metadata.get(id)
    if (!item) throw new NotFoundException(`No item ${id}`)
    if (item.type !== ITEM_TYPES.show) {
      throw new BadRequestException('Only a show can be re-pointed here.')
    }
    if (!isShowMatchChoice(body)) throw new BadRequestException('tmdbId must be a TMDB id')
    if (!this.tmdb.enabled)
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to search TMDB.')
    const moved = await this.service
      .fixShowMatch({ showId: id, tmdbId: body.tmdbId })
      .catch((error: unknown) => {
        if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
        throw error
      })
    if (moved == null) throw new NotFoundException('TMDB has no show with that id.')
    return this.details({ id: moved, request })
  }

  /** Marks a show or season a favourite, or not; a movie's or episode's files are favourites instead. */
  @ForViewers()
  @Put(':id/favourite')
  setFavourite(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): ItemDetails {
    if (!isFavouriteChange(body)) throw new BadRequestException('favourite must be true or false')
    const outcome = this.titleFavourites.set({
      itemId: id,
      favourite: body.favourite,
      account: this.accounts.keyOf({ request }),
    })
    switch (outcome) {
      case FAVOURITE_OUTCOMES.done:
        return this.details({ id, request })
      case FAVOURITE_OUTCOMES.missing:
        throw new NotFoundException(`No show or season ${id}`)
      case FAVOURITE_OUTCOMES.locked:
        throw new ForbiddenException('A locked library’s shows cannot be favourites.')
      default: {
        const unknown: never = outcome
        return unknown
      }
    }
  }

  @Get(':id')
  get(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): ItemDetails {
    return this.details({ id, request })
  }

  /**
   * A show's first episode not yet watched in the libraries this caller may
   * see, for its Play button; null once every one is.
   */
  @Get(':id/next')
  next(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): MediaItem | null {
    this.requireItem(id)
    const viewer = this.lock.viewer({ request })
    const libraryIds = this.libraries.ids().filter((libraryId) => viewer.seesLibrary(libraryId))
    return this.media.nextEpisode({
      showId: id,
      libraryIds,
      account: this.accounts.keyOf({ request }),
    })
  }

  /**
   * The episodes of a show or a season in a random order, among the files in
   * the libraries this caller may see, for its Shuffle button to play one
   * after another; empty with none to play.
   */
  @Get(':id/shuffle')
  shuffle(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): MediaItem[] {
    this.requireItem(id)
    const viewer = this.lock.viewer({ request })
    const libraryIds = this.libraries.ids().filter((libraryId) => viewer.seesLibrary(libraryId))
    return this.media.shuffledEpisodes({
      itemId: id,
      libraryIds,
      account: this.accounts.keyOf({ request }),
    })
  }

  /** Fetches the item from TMDB again now. One TMDB no longer has is gone after, so 404. */
  @AdminOnly()
  @Post(':id/refresh')
  @HttpCode(200)
  async refresh(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): Promise<ItemDetails> {
    this.requireItem(id)
    if (!this.tmdb.enabled) {
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to fetch details from TMDB.')
    }
    try {
      const kept = await this.refresher.refresh(id)
      if (!kept) throw new NotFoundException('TMDB no longer has this; it will be matched again.')
    } catch (error) {
      if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
      throw error
    }
    return this.details({ id, request })
  }

  /** Edit metadata: what the page shows, what TMDB says, and which fields were written over. */
  @AdminOnly()
  @Get(':id/metadata')
  getMetadata(@Param('id', ParseIntPipe) id: number): ItemMetadataState {
    const state = this.overrides.state(id)
    if (!state) throw new NotFoundException(`No item ${id}`)
    return state
  }

  /**
   * Edit metadata: each field given is written over TMDB's, or cleared back
   * to TMDB's with null. '' (0 for the year) shows nothing where TMDB has words.
   */
  @AdminOnly()
  @Put(':id/metadata')
  setMetadata(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): ItemDetails {
    this.requireItem(id)
    if (!isItemMetadataChange(body)) {
      throw new BadRequestException(
        'title must be text, year a number, tagline, summary and contentRating text; null clears one, and "" (0 for the year) shows none',
      )
    }
    if (body.title != null && body.title.trim() === '') {
      throw new BadRequestException('A title cannot be blank; send null to go back to TMDB’s.')
    }
    this.overrides.write({
      itemId: id,
      change: { ...body, ...(body.title == null ? {} : { title: body.title.trim() }) },
    })
    return this.details({ id, request })
  }

  /**
   * Edit images: every poster, backdrop and logo a movie or show could show,
   * the one beside the media first, then TMDB's, with the current one marked.
   */
  @AdminOnly()
  @Get(':id/images')
  async imageOptions(@Param('id', ParseIntPipe) id: number): Promise<ItemImageOptions> {
    const item = this.metadata.get(id)
    if (!item) throw new NotFoundException(`No item ${id}`)
    const { type } = item
    if (!isMatchItemType(type)) {
      throw new BadRequestException('Only a movie or show has pictures to choose from.')
    }
    const fetched =
      this.tmdb.enabled && !isLocal(item.tmdbId)
        ? await this.tmdb.images({ type, tmdbId: item.tmdbId }).catch((error: unknown) => {
            if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
            throw error
          })
        : { poster: [], backdrop: [], logo: [] }
    const options = (kind: ChoosableImageKind): ImageOption[] => {
      const current = this.stored.image({ itemId: id, kind })
      const local = this.stored.imageFrom({ itemId: id, kind, source: STORED_IMAGE_SOURCES.local })
      const own = this.stored.imageFrom({ itemId: id, kind, source: STORED_IMAGE_SOURCES.tmdb })
      const tmdb = fetched[kind]
      // TMDB's own choice is offered even when the images call left it out.
      const listed =
        own != null && !tmdb.some((image) => image.path === own)
          ? [{ path: own, width: null, height: null, language: null }, ...tmdb]
          : tmdb
      return [
        ...(local == null
          ? []
          : [
              {
                source: IMAGE_SOURCES.local,
                ref: local,
                width: null,
                height: null,
                language: null,
                current: current?.source === STORED_IMAGE_SOURCES.local,
              },
            ]),
        ...listed.map((image) => ({
          source: IMAGE_SOURCES.tmdb,
          ref: image.path,
          width: image.width,
          height: image.height,
          language: image.language,
          current: current?.source !== STORED_IMAGE_SOURCES.local && current?.ref === image.path,
        })),
      ]
    }
    return {
      poster: options(ITEM_IMAGE_KINDS.poster),
      backdrop: options(ITEM_IMAGE_KINDS.backdrop),
      logo: options(ITEM_IMAGE_KINDS.logo),
    }
  }

  /** Edit images: `{ source: 'tmdb', ref }` shows that picture of TMDB's; `{ source: 'local' }` goes back to the one beside the media, or TMDB's own. */
  @AdminOnly()
  @Put(':id/images/:kind')
  async chooseImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ItemDetails> {
    if (!isChoosableImageKind(kind)) throw new NotFoundException(`No ${kind} pictures to choose`)
    this.requireItem(id)
    if (!isImageChoice(body)) {
      throw new BadRequestException('Send { source: "tmdb", ref } or { source: "local" }')
    }
    if (body.source === IMAGE_SOURCES.tmdb && !TMDB_IMAGE_PATH.test(body.ref)) {
      throw new BadRequestException('ref must be a TMDB image path')
    }
    this.stored.chooseImage({
      itemId: id,
      kind,
      ref: body.source === IMAGE_SOURCES.tmdb ? body.ref : null,
    })
    return this.details({ id, request })
  }

  /** The picture beside the media, scaled, whatever the item shows: Edit images previews it. */
  @Get(':id/images/:kind/local')
  async localImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isItemImageKind(kind)) throw new NotFoundException(`No ${kind} pictures`)
    const local = this.stored.imageFrom({ itemId: id, kind, source: STORED_IMAGE_SOURCES.local })
    const path =
      local == null
        ? null
        : await this.images.local({ itemId: id, kind, source: local, width: IMAGE_WIDTHS[kind] })
    await sendImage({ reply, path, version: undefined })
  }

  /**
   * A poster, backdrop or still: the chosen picture first, then one beside
   * the media, then TMDB's. A poster comes narrower when `w` asks, so a card
   * fetches one no wider than it shows.
   */
  @Get(':id/images/:kind')
  async image(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Query('v') version: string | undefined,
    @Query('w') asked: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isItemImageKind(kind)) throw new NotFoundException(`No ${kind} pictures`)
    const width = pictureWidth({ kind, asked })
    const path = await this.pictureFiles.pathOf({ id, kind, width })
    await sendImage({ reply, path, version })
  }
}
