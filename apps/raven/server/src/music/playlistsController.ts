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
  isPlaylistTracksChange,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { Management } from '@/auth/management'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { MusicRepository } from '@/music/musicRepository'
import { Playlists } from '@/music/playlists'

const NAME_REFUSAL = `name must hold something besides spaces, up to ${PLAYLIST_LIMITS.name} characters`

const TRACKS_REFUSAL = `mediaIds must list up to ${PLAYLIST_LIMITS.tracks} track ids`

type PlaylistsControllerScopeProps = { request: FastifyRequest }

type PlaylistsControllerFindProps = { id: number; request: FastifyRequest }

type PlaylistsControllerCheckTracksProps = {
  mediaIds: readonly number[]
  request: FastifyRequest
}

type PlaylistsControllerTracksChangeProps = { id: number; body: unknown; request: FastifyRequest }

/**
 * The calling account's playlists. A playlist is in no library, so the lock
 * holds no route by its id; what a playlist holds is filtered instead: a
 * track in a library this caller may not see is left out of every answer
 * and cannot be added, as an album's page and its routes treat it. Another
 * account's playlist is answered as none at all.
 */
@Controller('api/playlists')
@Public()
export class PlaylistsController {
  constructor(
    @Inject(Playlists) private readonly playlists: Playlists,
    @Inject(MusicRepository) private readonly music: MusicRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(Management) private readonly management: Management,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** Whose playlists a request reads, and the libraries whose tracks it may not see. */
  private scope({ request }: PlaylistsControllerScopeProps) {
    const viewer = this.lock.viewer({ request })
    return {
      account: this.accounts.keyOf({ request }),
      hidden: [...this.libraries.lockedIds()].filter((id) => !viewer.seesLibrary(id)),
    }
  }

  private find({ id, request }: PlaylistsControllerFindProps): PlaylistDetails {
    const playlist = this.playlists.get({ id, ...this.scope({ request }) })
    if (!playlist) throw new NotFoundException(`No playlist ${id}`)
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
    this.find({ id, request })
    this.checkTracks({ mediaIds: body.mediaIds, request })
    return { id, mediaIds: body.mediaIds, ...this.scope({ request }) }
  }

  /** The account's playlists, most recently changed first. */
  @Get()
  list(@Req() request: FastifyRequest): PlaylistSummary[] {
    return this.playlists.list(this.scope({ request }))
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
  get(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): PlaylistDetails {
    return this.find({ id, request })
  }

  @ForViewers()
  @Put(':id')
  rename(
    @Param('id', ParseIntPipe) id: number,
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
  remove(@Param('id', ParseIntPipe) id: number, @Req() request: FastifyRequest): void {
    if (!this.playlists.remove({ id, account: this.accounts.keyOf({ request }) })) {
      throw new NotFoundException(`No playlist ${id}`)
    }
  }

  /** The playlist's tracks in the order sent, in place of the old order: how a track is moved or taken out. */
  @ForViewers()
  @Put(':id/tracks')
  replaceTracks(
    @Param('id', ParseIntPipe) id: number,
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
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): PlaylistDetails {
    this.playlists.append(this.tracksChange({ id, body, request }))
    return this.find({ id, request })
  }
}
