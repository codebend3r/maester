import {
  DOWNLOAD_ARTWORK_KINDS,
  type DownloadArtwork,
  type DownloadFacts,
  type ItemSummary,
  type MediaItem,
  pickScore,
  RATING_SOURCES,
} from '@raven/core'

/** An item's poster as the page addresses it, or nothing when the server has none. */
export const posterOf = ({
  id,
  posterVersion,
}: Pick<ItemSummary, 'id' | 'posterVersion'>): DownloadArtwork =>
  posterVersion === null
    ? { kind: DOWNLOAD_ARTWORK_KINDS.none }
    : { kind: DOWNLOAD_ARTWORK_KINDS.poster, itemId: id, version: posterVersion }

type CoverOfProps = { cover: { albumId: number; coverVersion: string | null } | null }

/** The album cover a music group shows, or nothing when the server has none. */
export const coverOf = ({ cover }: CoverOfProps): DownloadArtwork =>
  cover === null || cover.coverVersion === null
    ? { kind: DOWNLOAD_ARTWORK_KINDS.none }
    : { kind: DOWNLOAD_ARTWORK_KINDS.cover, albumId: cover.albumId, version: cover.coverVersion }

/** A file's own picture: its movie's or episode's poster. */
export const artworkOfMedia = ({ item }: MediaItem): DownloadArtwork =>
  item === null ? { kind: DOWNLOAD_ARTWORK_KINDS.none } : posterOf(item)

/** What a download keeps of its file so a grid can sort it by any field a library can. */
export const factsOf = (media: MediaItem): DownloadFacts => ({
  year: media.item?.year ?? media.year,
  score:
    media.item === null
      ? null
      : (pickScore({ ratings: media.item.ratings, source: RATING_SOURCES.tmdb })?.value ?? null),
  bitrate: media.bitrate,
  pixels: media.width === null || media.height === null ? null : media.width * media.height,
  addedAt: media.addedAt,
  changedAt: media.changedAt,
})

type FactsBeforeProps = { createdAt: number }

/** What a download confirmed before its facts were kept can still say: when it was added. */
export const factsBefore = ({ createdAt }: FactsBeforeProps): DownloadFacts => {
  const at = new Date(createdAt).toISOString()
  return { year: null, score: null, bitrate: null, pixels: null, addedAt: at, changedAt: at }
}
