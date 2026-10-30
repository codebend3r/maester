import { Controller, Get, Inject, Req } from '@nestjs/common'
import type { AlbumSummary, Artist, ItemSummary, PosterEntry } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { MediaRepository } from '@/media/mediaRepository'
import { TitleFavourites } from '@/media/titleFavourites'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { MusicFavourites } from '@/music/musicFavourites'

/**
 * Favourites cut across libraries, so they hang off their own root rather
 * than a library's. A locked library's are left out, whether or not the PIN
 * is entered.
 */
@Controller('api/favourites')
export class FavouritesController {
  constructor(
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(TitleFavourites) private readonly titles: TitleFavourites,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(MusicFavourites) private readonly music: MusicFavourites,
  ) {}

  /** Every favourite video, each with the poster its card shows. */
  @Get()
  list(@Req() request: FastifyRequest): PosterEntry[] {
    return this.media.withPosters(
      this.media.listFavourites({ account: this.accounts.keyOf({ request }) }),
    )
  }

  /** Every favourite show and season. */
  @Get('titles')
  listTitles(@Req() request: FastifyRequest): ItemSummary[] {
    return this.titles.list({ account: this.accounts.keyOf({ request }) })
  }

  /** Every favourite album, most recently marked first. */
  @Get('albums')
  listAlbums(@Req() request: FastifyRequest): AlbumSummary[] {
    return this.music.albums({ account: this.accounts.keyOf({ request }) })
  }

  /** Every favourite artist, most recently marked first. */
  @Get('artists')
  listArtists(@Req() request: FastifyRequest): Artist[] {
    return this.music.artists({ account: this.accounts.keyOf({ request }) })
  }
}
