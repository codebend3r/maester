import { Controller, Get, Inject } from '@nestjs/common'
import type { AlbumSummary, Artist, ItemSummary, PosterEntry } from '@raven/core'
import { MediaRepository } from '@/media/mediaRepository'
import { TitleFavourites } from '@/media/titleFavourites'
import { MusicFavourites } from '@/music/musicFavourites'
import { ViewingAccount } from '@/media/viewingAccountParam'
import type { AccountKey } from '@/media/viewingAccountKeys'

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
    @Inject(MusicFavourites) private readonly music: MusicFavourites,
  ) {}

  /** Every favourite video, each with the poster its card shows. */
  @Get()
  list(@ViewingAccount() account: AccountKey): PosterEntry[] {
    return this.media.withPosters(this.media.listFavourites({ account }))
  }

  /** Every favourite show and season. */
  @Get('titles')
  listTitles(@ViewingAccount() account: AccountKey): ItemSummary[] {
    return this.titles.list({ account, libraryId: null })
  }

  /** Every favourite album, most recently marked first. */
  @Get('albums')
  listAlbums(@ViewingAccount() account: AccountKey): AlbumSummary[] {
    return this.music.albums({ account })
  }

  /** Every favourite artist, most recently marked first. */
  @Get('artists')
  listArtists(@ViewingAccount() account: AccountKey): Artist[] {
    return this.music.artists({ account })
  }
}
