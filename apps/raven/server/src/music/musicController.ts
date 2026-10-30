import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type AlbumDetails,
  type AlbumMatchCandidate,
  type AlbumSummary,
  type Artist,
  type ArtistDetails,
  type Lyrics,
  type MusicListParams,
  type TrackPage,
  isAlbumMatchChoice,
  isFavouriteChange,
  isRecord,
  isString,
  musicListQuery,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { AdminOnly, ForViewers } from '@/admin/adminGuard'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { LockService, PRIVACIES } from '@/lock/lockService'
import { FAVOURITE_OUTCOMES, type FavouriteOutcome } from '@/media/favouriteOutcomes'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { AlbumMatching } from '@/music/albumMatching'
import { MUSICBRAINZ_ERROR_KINDS, MusicBrainzError } from '@/music/musicBrainzClient'
import { MusicFavourites } from '@/music/musicFavourites'
import { MusicRepository } from '@/music/musicRepository'
import { TrackLyrics } from '@/music/trackLyrics'

/** A MusicBrainz failure as a route answers it: 404 for an id it does not have, 503 when it is away. */
const musicBrainzFailed = (error: unknown): never => {
  if (error instanceof MusicBrainzError) {
    if (error.kind === MUSICBRAINZ_ERROR_KINDS.notFound) throw new NotFoundException(error.message)
    throw new ServiceUnavailableException(error.message)
  }
  throw error
}

type FavouriteAnsweredProps = { outcome: FavouriteOutcome; missing: string; locked: string }

/** Throws for a favourite that could not be marked: 404 for nothing by that id, 403 for a locked library's. */
const favouriteAnswered = ({ outcome, missing, locked }: FavouriteAnsweredProps): void => {
  switch (outcome) {
    case FAVOURITE_OUTCOMES.done:
      return
    case FAVOURITE_OUTCOMES.missing:
      throw new NotFoundException(missing)
    case FAVOURITE_OUTCOMES.locked:
      throw new ForbiddenException(locked)
    default: {
      const unknown: never = outcome
      return unknown
    }
  }
}

/** A listing's search, sort and page, read as the client's `musicListQuery.encode` wrote them. */
const listParams = (query: unknown): MusicListParams =>
  musicListQuery.decode(isRecord(query) ? query : {})

/** A music library's artists, albums and tracks; each route is held by the library's lock. */
@Controller('api/libraries')
@PrivateBy(PRIVACIES.library)
export class LibraryMusicController {
  constructor(
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MusicRepository) private readonly music: MusicRepository,
  ) {}

  private find(id: number): void {
    if (!this.libraries.get(id)) throw new NotFoundException(`No library ${id}`)
  }

  /** The artists credited in the library, by name. */
  @Get(':id/artists')
  listArtists(@Param('id', ParseIntPipe) id: number, @Query() query: unknown): Artist[] {
    this.find(id)
    return this.music.listArtists({ libraryId: id, ...listParams(query) })
  }

  /** The library's albums in the order asked; search matches titles and artists. */
  @Get(':id/albums')
  listAlbums(@Param('id', ParseIntPipe) id: number, @Query() query: unknown): AlbumSummary[] {
    this.find(id)
    return this.music.listAlbums({ libraryId: id, ...listParams(query) })
  }

  /** One page of the library's tracks, since a music library holds tens of thousands. */
  @Get(':id/tracks')
  listTracks(@Param('id', ParseIntPipe) id: number, @Query() query: unknown): TrackPage {
    this.find(id)
    return this.music.listTracks({ libraryId: id, ...listParams(query) })
  }
}

type AlbumsControllerFindProps = { id: number; request: FastifyRequest }

/** An album's page, its favourite mark and its Fix match, held by the lock of the library it is in. */
@Controller('api/albums')
@PrivateBy(PRIVACIES.album)
export class AlbumsController {
  constructor(
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(AlbumMatching) private readonly matching: AlbumMatching,
    @Inject(MusicFavourites) private readonly favourites: MusicFavourites,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** The album's page, with whether the caller's account marked it a favourite. */
  private find({ id, request }: AlbumsControllerFindProps): AlbumDetails {
    const album = this.music.album(id)
    if (!album) throw new NotFoundException(`No album ${id}`)
    const account = this.accounts.keyOf({ request })
    return { ...album, isFavourite: this.favourites.isAlbum({ albumId: id, account }) }
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): AlbumDetails {
    return this.find({ id, request })
  }

  /** Marks the album the account's favourite, or not; a locked library's album cannot be one. */
  @ForViewers()
  @Put(':id/favourite')
  setFavourite(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): AlbumDetails {
    if (!isFavouriteChange(body)) throw new BadRequestException('favourite must be true or false')
    favouriteAnswered({
      outcome: this.favourites.setAlbum({
        albumId: id,
        favourite: body.favourite,
        account: this.accounts.keyOf({ request }),
      }),
      missing: `No album ${id}`,
      locked: 'A locked library’s albums cannot be favourites.',
    })
    return this.find({ id, request })
  }

  /** MusicBrainz's releases for Fix match, scored against the album, best first; `q` searches for other words. */
  @AdminOnly()
  @Get(':id/match/search')
  async searchMatches(
    @Param('id', ParseIntPipe) id: number,
    @Query('query') query: unknown,
  ): Promise<AlbumMatchCandidate[]> {
    const album = this.music.albumToMatch(id)
    if (!album) throw new NotFoundException(`No album ${id}`)
    const typed = isString(query) ? query.trim() : ''
    return this.matching
      .search({ album, query: typed === '' ? undefined : typed })
      .catch(musicBrainzFailed)
  }

  /** Saves a Fix match: `{ mbid }` says which release the album is, `{ mbid: null }` that it is none MusicBrainz lists. */
  @AdminOnly()
  @Put(':id/match')
  async setMatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<AlbumDetails> {
    if (!isAlbumMatchChoice(body)) {
      throw new BadRequestException('mbid must be a MusicBrainz release id or null')
    }
    const isFound = await this.matching.fix({ id, mbid: body.mbid }).catch(musicBrainzFailed)
    if (!isFound) throw new NotFoundException(`No album ${id}`)
    return this.find({ id, request })
  }
}

type ArtistsControllerFindProps = { id: number; request: FastifyRequest }

/** Artists are in no library; an artist's page hides the albums in libraries this caller may not see. */
@Controller('api/artists')
@Public()
export class ArtistsController {
  constructor(
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(MusicFavourites) private readonly favourites: MusicFavourites,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** The artist's page as this caller may see it, with whether its account marked them a favourite. */
  private find({ id, request }: ArtistsControllerFindProps): ArtistDetails {
    const { seesLibrary } = this.lock.viewer({ request })
    const artist = this.music.artist({ id, seesLibrary })
    if (!artist) throw new NotFoundException(`No artist ${id}`)
    const account = this.accounts.keyOf({ request })
    return { ...artist, isFavourite: this.favourites.isArtist({ artistId: id, account }) }
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): ArtistDetails {
    return this.find({ id, request })
  }

  /** Marks the artist the account's favourite, or not; one only locked libraries credit cannot be one. */
  @ForViewers()
  @Put(':id/favourite')
  setFavourite(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): ArtistDetails {
    if (!isFavouriteChange(body)) throw new BadRequestException('favourite must be true or false')
    favouriteAnswered({
      outcome: this.favourites.setArtist({
        artistId: id,
        favourite: body.favourite,
        account: this.accounts.keyOf({ request }),
      }),
      missing: `No artist ${id}`,
      locked: 'An artist only locked libraries hold cannot be a favourite.',
    })
    return this.find({ id, request })
  }
}

/** A track by its media id: what is kept of it beyond the file, held by the lock of its library. */
@Controller('api/tracks')
@PrivateBy(PRIVACIES.media)
export class TracksController {
  constructor(@Inject(TrackLyrics) private readonly lyrics: TrackLyrics) {}

  /** The track's lyrics: from its tags, a sidecar `.lrc`, or LRCLIB, else none. */
  @Get(':id/lyrics')
  async getLyrics(@Param('id', ParseIntPipe) id: number): Promise<Lyrics> {
    const lyrics = await this.lyrics.of(id)
    if (lyrics === null) throw new NotFoundException(`No track ${id}`)
    return lyrics
  }
}
