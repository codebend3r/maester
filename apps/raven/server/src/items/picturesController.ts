import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common'
import { ITEM_IMAGE_KINDS, PICTURE_PARAMS, PICTURE_PATHS, isItemImageKind } from '@raven/core'
import { sameSecret } from '@shared/server'
import type { FastifyReply } from 'fastify'
import { OpenToAnyone } from '@/auth/accountGuard'
import { ItemPictureFiles, pictureWidth } from '@/items/itemPictureFiles'
import { IMAGE_AUDIENCES, sendImage } from '@/items/sendImage'
import { Public } from '@/lock/lockGuard'
import { IMAGE_WIDTHS, ImageCache } from '@/metadata/imageCache'
import { ItemImagesRepository } from '@/metadata/itemImagesRepository'
import { PictureVersions } from '@/metadata/pictureVersions'
import { AlbumCovers } from '@/music/albumCovers'
import { ArtistBackgroundOptions } from '@/music/artistBackgroundOptions'
import { type ArtistPicture, MusicCoverStore } from '@/music/musicCoverStore'
import { WikimediaClient } from '@/music/wikimediaClient'
import { PeopleRepository } from '@/people/peopleRepository'
import { QUERY_PARAMS } from '@/queryValues'

type ArtistPhotoPathProps = { id: number; artist: ArtistPicture }

type IsCurrentProps = { given: string; current: string | null | undefined }

/** Whether `given` is the picture's current version; constant time, and never for a picture with none. */
const isCurrent = ({ given, current }: IsCurrentProps) =>
  current != null && sameSecret({ given, expected: current })

/**
 * Pictures by their capability address: an item's or a person's picture,
 * named with its current version, which `PictureVersions` keys with this
 * server's secret. Only someone a listing or a page showed the version to
 * can name it, so the address alone is the permission, the same for whoever
 * holds it, and the answer can be cached by anyone: the browser, Netlify's
 * CDN and its Image CDN, which resizes and re-encodes it at the edge without
 * a cookie or a token. A version that is not the current one, a guess or
 * one the picture has moved on from, finds nothing.
 *
 * Open to anyone, and held by no lock: the version stands in for both, as
 * it was only ever handed to a caller the account gate and the PIN lock let
 * see the item. A cached copy outlives an account's removal; a new picture
 * gets a new address.
 */
@Controller()
@Public()
export class PicturesController {
  constructor(
    @Inject(ItemImagesRepository) private readonly stored: ItemImagesRepository,
    @Inject(ItemPictureFiles) private readonly pictureFiles: ItemPictureFiles,
    @Inject(PeopleRepository) private readonly people: PeopleRepository,
    @Inject(ImageCache) private readonly images: ImageCache,
    @Inject(PictureVersions) private readonly versions: PictureVersions,
    @Inject(AlbumCovers) private readonly covers: AlbumCovers,
    @Inject(MusicCoverStore) private readonly coverStore: MusicCoverStore,
    @Inject(WikimediaClient) private readonly wikimedia: WikimediaClient,
    @Inject(ArtistBackgroundOptions) private readonly backgrounds: ArtistBackgroundOptions,
  ) {}

  /** An item's poster, backdrop, logo or still; a poster comes narrower when `w` asks. */
  @OpenToAnyone()
  @Get(PICTURE_PATHS.item)
  async item(
    @Param(PICTURE_PARAMS.id, ParseIntPipe) id: number,
    @Param(PICTURE_PARAMS.kind) kind: string,
    @Param(PICTURE_PARAMS.version) version: string,
    @Query(QUERY_PARAMS.width) asked: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isItemImageKind(kind)) throw new NotFoundException('No picture')
    // Each library can show its own choice, so the version says which picture it is.
    const named = this.stored
      .candidates({ itemId: id, kind })
      .find((candidate) => isCurrent({ given: version, current: candidate.version }))
    if (!named) throw new NotFoundException('No picture')
    const width = pictureWidth({ kind, asked })
    const path = await this.pictureFiles.pathOf({ id, kind, width, image: named.image })
    await sendImage({ reply, path, version, audience: IMAGE_AUDIENCES.everyone })
  }

  /** An album's cover, square, at a poster's widths: its own, or narrower when `w` asks. */
  @OpenToAnyone()
  @Get(PICTURE_PATHS.album)
  async album(
    @Param(PICTURE_PARAMS.id, ParseIntPipe) id: number,
    @Param(PICTURE_PARAMS.version) version: string,
    @Query(QUERY_PARAMS.width) asked: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const width = pictureWidth({ kind: ITEM_IMAGE_KINDS.poster, asked })
    const path = await this.covers.pathOf({ id, version, width })
    await sendImage({ reply, path, version, audience: IMAGE_AUDIENCES.everyone })
  }

  /** An artist's photo from Wikimedia Commons, or the background an owner chose for them. */
  @OpenToAnyone()
  @Get(PICTURE_PATHS.artist)
  async artist(
    @Param(PICTURE_PARAMS.id, ParseIntPipe) id: number,
    @Param(PICTURE_PARAMS.version) version: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const artist = this.coverStore.artistPicture({ id, version })
    if (artist === null) throw new NotFoundException('No picture')
    const path =
      artist.background === null
        ? await this.artistPhotoPath({ id, artist })
        : await this.backgrounds.pathOf({ artistId: id, source: artist.background })
    await sendImage({ reply, path, version, audience: IMAGE_AUDIENCES.everyone })
  }

  /** The cached file of the artist's default photo, looked for through MusicBrainz and Wikidata once. */
  private async artistPhotoPath({ id, artist }: ArtistPhotoPathProps): Promise<string | null> {
    if (artist.mbid === null) throw new NotFoundException('No picture')
    const picture =
      artist.picture ?? (!artist.isFetched ? await this.wikimedia.artistPhoto(artist.mbid) : null)
    if (!artist.isFetched) this.coverStore.setArtistPicture({ id, picture })
    if (picture === null) throw new NotFoundException('No picture')
    return this.images.artist({ artistId: id, source: picture })
  }

  /** One of the options an owner may set as an artist's background, by its key. */
  @OpenToAnyone()
  @Get(PICTURE_PATHS.artistBackground)
  async artistBackground(
    @Param(PICTURE_PARAMS.id, ParseIntPipe) id: number,
    @Param(PICTURE_PARAMS.key) key: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const source = this.backgrounds.sourceOf({ artistId: id, key })
    if (source === null) throw new NotFoundException('No picture')
    const path = await this.backgrounds.pathOf({ artistId: id, source })
    await sendImage({ reply, path, version: key, audience: IMAGE_AUDIENCES.everyone })
  }

  /** A person's photo from TMDB. */
  @OpenToAnyone()
  @Get(PICTURE_PATHS.photo)
  async photo(
    @Param(PICTURE_PARAMS.id, ParseIntPipe) id: number,
    @Param(PICTURE_PARAMS.version) version: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const photo = this.people.photo(id)
    if (
      !isCurrent({ given: version, current: this.versions.photo({ id, photo }) }) ||
      photo == null
    ) {
      throw new NotFoundException('No picture')
    }
    const path = await this.images.tmdb({ path: photo, width: IMAGE_WIDTHS.photo })
    await sendImage({ reply, path, version, audience: IMAGE_AUDIENCES.everyone })
  }
}
