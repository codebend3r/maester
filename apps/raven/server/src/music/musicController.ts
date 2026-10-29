import {
  BadRequestException,
  Body,
  Controller,
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
  type MusicListParams,
  type TrackPage,
  isAlbumMatchChoice,
  isRecord,
  musicListQuery,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { AdminOnly } from '@/admin/adminGuard'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { LockService, PRIVACIES } from '@/lock/lockService'
import { AlbumMatching } from '@/music/albumMatching'
import { MUSICBRAINZ_ERROR_KINDS, MusicBrainzError } from '@/music/musicBrainzClient'
import { MusicRepository } from '@/music/musicRepository'

/** A MusicBrainz failure as a route answers it: 404 for an id it does not have, 503 when it is away. */
const musicBrainzFailed = (error: unknown): never => {
  if (error instanceof MusicBrainzError) {
    if (error.kind === MUSICBRAINZ_ERROR_KINDS.notFound) throw new NotFoundException(error.message)
    throw new ServiceUnavailableException(error.message)
  }
  throw error
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

/** An album's page and its Fix match, held by the lock of the library it is in. */
@Controller('api/albums')
@PrivateBy(PRIVACIES.album)
export class AlbumsController {
  constructor(
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(AlbumMatching) private readonly matching: AlbumMatching,
  ) {}

  private find(id: number): AlbumDetails {
    const album = this.music.album(id)
    if (!album) throw new NotFoundException(`No album ${id}`)
    return album
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): AlbumDetails {
    return this.find(id)
  }

  /** MusicBrainz's releases for Fix match, scored against the album, best first; `q` searches for other words. */
  @AdminOnly()
  @Get(':id/match/search')
  async searchMatches(
    @Param('id', ParseIntPipe) id: number,
    @Query('query') query: string | undefined,
  ): Promise<AlbumMatchCandidate[]> {
    const album = this.music.albumToMatch(id)
    if (!album) throw new NotFoundException(`No album ${id}`)
    const typed = query?.trim() ?? ''
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
  ): Promise<AlbumDetails> {
    if (!isAlbumMatchChoice(body)) {
      throw new BadRequestException('mbid must be a MusicBrainz release id or null')
    }
    const isFound = await this.matching.fix({ id, mbid: body.mbid }).catch(musicBrainzFailed)
    if (!isFound) throw new NotFoundException(`No album ${id}`)
    return this.find(id)
  }
}

/** Artists are in no library; an artist's page hides the albums in libraries this caller may not see. */
@Controller('api/artists')
@Public()
export class ArtistsController {
  constructor(
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(LockService) private readonly lock: LockService,
  ) {}

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): ArtistDetails {
    const { seesLibrary } = this.lock.viewer({ request })
    const artist = this.music.artist({ id, seesLibrary })
    if (!artist) throw new NotFoundException(`No artist ${id}`)
    return artist
  }
}
