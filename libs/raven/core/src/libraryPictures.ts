import type { ItemDetails } from '@/contract'

type PicturesInProps = {
  details: ItemDetails
  /** The library the page shows the item as; null for none. */
  libraryId: number | null
}

/**
 * An item's page as `libraryId` shows it: with the poster, backdrop and
 * logo chosen there, since Edit images chooses them for one library alone.
 * A library the item has no pictures listed for, or none, leaves its own.
 */
export const picturesIn = ({ details, libraryId }: PicturesInProps): ItemDetails => {
  const pictures =
    (details.libraryPictures ?? []).find((entry) => entry.libraryId === libraryId) ?? null
  if (!pictures) return details
  return {
    ...details,
    posterVersion: pictures.posterVersion,
    backdropVersion: pictures.backdropVersion,
    logoVersion: pictures.logoVersion,
  }
}
