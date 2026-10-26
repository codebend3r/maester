import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { ITEM_IMAGE_KINDS, type ItemImageKind, POSTER_WIDTHS, posterWidthFrom } from '@raven/core'
import { IMAGE_WIDTHS, type ImageWidth, ImageCache } from '@/metadata/imageCache'
import { ItemImagesRepository, STORED_IMAGE_SOURCES } from '@/metadata/itemImagesRepository'

type PictureWidthProps = {
  kind: ItemImageKind
  asked: unknown
}

/**
 * The width a picture of `kind` is served at: its own, or for a poster a
 * narrower one `asked` names in `?w=`, so a card fetches one no wider than
 * it shows. A width that is not a poster's, or one asked of another kind, is
 * refused.
 */
export const pictureWidth = ({ kind, asked }: PictureWidthProps): ImageWidth => {
  const posterWidth = asked === undefined ? undefined : posterWidthFrom(asked)
  if (posterWidth === null || (posterWidth !== undefined && kind !== ITEM_IMAGE_KINDS.poster)) {
    throw new BadRequestException(`w must be one of ${POSTER_WIDTHS.join(', ')}, for a poster`)
  }
  return posterWidth ?? IMAGE_WIDTHS[kind]
}

type ItemPictureFilesPathOfProps = {
  id: number
  kind: ItemImageKind
  width: ImageWidth
}

/** Where on disk the picture an item shows is kept, at the width it is asked for. */
@Injectable()
export class ItemPictureFiles {
  constructor(
    @Inject(ImageCache) private readonly images: ImageCache,
    @Inject(ItemImagesRepository) private readonly stored: ItemImagesRepository,
  ) {}

  /**
   * The chosen picture first, then one beside the media, then TMDB's; null
   * when the item has none that can be had.
   */
  async pathOf({ id, kind, width }: ItemPictureFilesPathOfProps): Promise<string | null> {
    const image = this.stored.image({ itemId: id, kind })
    const chosen =
      image?.source === STORED_IMAGE_SOURCES.chosen
        ? await this.images.tmdb({ path: image.ref, width })
        : null
    if (chosen != null) return chosen
    const localRef =
      image?.source === STORED_IMAGE_SOURCES.local
        ? image.ref
        : this.stored.imageFrom({ itemId: id, kind, source: STORED_IMAGE_SOURCES.local })
    const local =
      localRef == null
        ? null
        : await this.images.local({ itemId: id, kind, source: localRef, width })
    if (local != null) return local
    // A picture beside the media that will not decode falls back to TMDB's.
    const tmdbPath = this.stored.imageFrom({ itemId: id, kind, source: STORED_IMAGE_SOURCES.tmdb })
    return tmdbPath == null ? null : this.images.tmdb({ path: tmdbPath, width })
  }
}
