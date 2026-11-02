import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common'
import {
  LOCKED_STATUS,
  PLAYLIST_LIMITS,
  type PlaylistDetails,
  type PlaylistSummary,
  isPlaylistInput,
  isPlaylistSharing,
  isPlaylistTracksChange,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { Management } from '@/auth/management'
import { Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { ListenerScopes } from '@/music/listenerScope'
import { MusicRepository } from '@/music/musicRepository'
import { Playlists } from '@/music/playlists'
import { ROUTE_PARAMS } from '@/requestParts'

const NAME_REFUSAL = `name must hold something besides spaces, up to ${PLAYLIST_LIMITS.name} characters`

const TRACKS_REFUSAL = `mediaIds must list up to ${PLAYLIST_LIMITS.tracks} track ids`

const SHARING_REFUSAL = 'isShared must be true or false'

type PlaylistsControllerFindProps = { id: number; request: FastifyRequest }

type PlaylistsControllerCheckTracksProps = {
  mediaIds: readonly number[]
  request: FastifyRequest
}

type PlaylistsControllerTracksChangeProps = { id: number; body: unknown; request: FastifyRequest }

/**
 * The calling account's playlists, and every account's shared ones, which
 * it may read, play and copy. A playlist is in no library, so the lock
 * holds no route by its id; what a playlist holds is filtered instead: a
 * track in a library this caller may not see is left out of every answer
 * and every copy, and cannot be added, as an album's page and its routes
 * treat it. Another account's playlist is answered as none at all when it
 * is not shared, and to every write when it is.
 */
@Controller('api/playlists')
@Public()
export class PlaylistsController {
  constructor(
    @Inject(Playlists) private readonly playlists: Playlists,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(Management) private readonly management: Management,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(ListenerScopes) private readonly scopes: ListenerScopes,
  ) {}

  private find({ id, request }: PlaylistsControllerFindProps): PlaylistDetails {
    const playlist = this.playlists.get({ id, ...this.scopes.of({ request }) })
    if (!playlist) throw new NotFoundException(`No playlist ${id}`)
    return playlist
  }

  /** The account's own playlist `id`; 404 for one it may only read, as for none. */
  private findOwn({ id, request }: PlaylistsControllerFindProps): PlaylistDetails {
    const playlist = this.find({ id, request })
    if (!playlist.playlist.isOwn) throw new NotFoundException(`No playlist ${id}`)
    return playlist
  }

  /**
   * Refuses ids that are no track the caller may see: 404, or 423 for a
   * locked library's track to one who could enter the PIN, as the lock
   * answers a route by the track's own id.
   */
  private checkTracks({ mediaIds, request }: PlaylistsControllerCheckTracksProps): void {
    const tracks = this.music.tracks(mediaIds)
    const viewer = this.lock.viewer({ request })
    const missing = mediaIds.find((id) => !tracks.has(id))
    if (missing !== undefined) throw new NotFoundException(`No track ${missing}`)
    const held = mediaIds.find((id) => {
      const libraryId = tracks.get(id)?.libraryId ?? null
      return libraryId !== null && !viewer.seesLibrary(libraryId)
    })
    if (held === undefined) return
    if (!this.management.canManage({ request })) throw new NotFoundException(`No track ${held}`)
    throw new HttpException('This library is locked.', LOCKED_STATUS)
  }

  /**
   * A body of tracks for the account's playlist `id`, each one checked, and
   * whose playlist it changes: 400 for a body it cannot read, 404 for no
   * such playlist of the account's, before a track is looked at.
   */
  private tracksChange({ id, body, request }: PlaylistsControllerTracksChangeProps) {
    if (!isPlaylistTracksChange(body)) throw new BadRequestException(TRACKS_REFUSAL)
    this.findOwn({ id, request })
    this.checkTracks({ mediaIds: body.mediaIds, request })
    return { id, mediaIds: body.mediaIds, ...this.scopes.of({ request }) }
  }

  /** The account's playlists and every account's shared ones, most recently changed first. */
  @Get()
  list(@Req() request: FastifyRequest): PlaylistSummary[] {
    return this.playlists.list(this.scopes.of({ request }))
  }

  @ForViewers()
  @Post()
  create(@Body() body: unknown, @Req() request: FastifyRequest): PlaylistDetails {
    if (!isPlaylistInput(body)) throw new BadRequestException(NAME_REFUSAL)
    const id = this.playlists.create({
      name: body.name.trim(),
      account: this.accounts.keyOf({ request }),
    })
    return this.find({ id, request })
  }

  @Get(':id')
  get(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): PlaylistDetails {
    return this.find({ id, request })
  }

  @ForViewers()
  @Put(':id')
  rename(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): PlaylistDetails {
    if (!isPlaylistInput(body)) throw new BadRequestException(NAME_REFUSAL)
    const isRenamed = this.playlists.rename({
      id,
      name: body.name.trim(),
      account: this.accounts.keyOf({ request }),
    })
    if (!isRenamed) throw new NotFoundException(`No playlist ${id}`)
    return this.find({ id, request })
  }

  @ForViewers()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param(ROUTE_PARAMS.id, ParseIntPipe) id: number, @Req() request: FastifyRequest): void {
    if (!this.playlists.remove({ id, account: this.accounts.keyOf({ request }) })) {
      throw new NotFoundException(`No playlist ${id}`)
    }
  }

  /** The playlist's tracks in the order sent, in place of the old order: how a track is moved or taken out. */
  @ForViewers()
  @Put(':id/tracks')
  replaceTracks(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): PlaylistDetails {
    this.playlists.replace(this.tracksChange({ id, body, request }))
    return this.find({ id, request })
  }

  /** Adds tracks at the playlist's end, in the order sent. */
  @ForViewers()
  @Post(':id/tracks')
  appendTracks(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): PlaylistDetails {
    this.playlists.append(this.tracksChange({ id, body, request }))
    return this.find({ id, request })
  }

  /** Shares the account's own playlist with every account, or stops sharing it. */
  @ForViewers()
  @Put(':id/sharing')
  setSharing(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): PlaylistDetails {
    if (!isPlaylistSharing(body)) throw new BadRequestException(SHARING_REFUSAL)
    const isChanged = this.playlists.share({
      id,
      isShared: body.isShared,
      account: this.accounts.keyOf({ request }),
    })
    if (!isChanged) throw new NotFoundException(`No playlist ${id}`)
    return this.find({ id, request })
  }

  /** Copies a playlist the account may read, its own or a shared one, into a new one of its own. */
  @ForViewers()
  @Post(':id/copy')
  copy(
    @Param(ROUTE_PARAMS.id, ParseIntPipe) id: number,
    @Req() request: FastifyRequest,
  ): PlaylistDetails {
    const copy = this.playlists.copy({ id, ...this.scopes.of({ request }) })
    if (copy === null) throw new NotFoundException(`No playlist ${id}`)
    return this.find({ id: copy, request })
  }
}
