import { DOWNLOAD_ARTWORK_KINDS, type DownloadArtwork as Artwork } from '@raven/core'
import type { ComponentType } from 'react'
import { AlbumCover } from '@/components/AlbumCover/AlbumCover'
import { Picture } from '@/components/PosterImage/PosterImage'
import { type PosterSizes, posterSources } from '@/lib/posters'

type ArtworkViewProps = {
  artwork: Artwork
  /** What the picture shows when there is none: the title's first letter. */
  initial: string
  sizes: PosterSizes
}

type PosterViewProps = ArtworkViewProps

const PosterView = ({ artwork, initial, sizes }: PosterViewProps) => {
  const source =
    artwork.kind === DOWNLOAD_ARTWORK_KINDS.poster
      ? posterSources({ item: { id: artwork.itemId, posterVersion: artwork.version }, sizes })
      : null
  return <Picture sources={source === null ? [] : [source]} initial={initial} />
}

type CoverViewProps = ArtworkViewProps

const CoverView = ({ artwork, initial, sizes }: CoverViewProps) =>
  artwork.kind === DOWNLOAD_ARTWORK_KINDS.cover && (
    <AlbumCover
      album={{ id: artwork.albumId, title: initial, coverVersion: artwork.version }}
      sizes={sizes}
    />
  )

type NoViewProps = ArtworkViewProps

const NoView = ({ initial }: NoViewProps) => <Picture sources={[]} initial={initial} />

const ARTWORK_VIEWS = {
  [DOWNLOAD_ARTWORK_KINDS.poster]: PosterView,
  [DOWNLOAD_ARTWORK_KINDS.cover]: CoverView,
  [DOWNLOAD_ARTWORK_KINDS.none]: NoView,
} as const satisfies Record<Artwork['kind'], ComponentType<ArtworkViewProps>>

type DownloadArtworkProps = ArtworkViewProps

/**
 * A download's picture: its title's poster, an album's cover for audio, else the first letter.
 * The frame is the container's to give, as a poster's is everywhere else.
 */
export const DownloadArtwork = ({ artwork, initial, sizes }: DownloadArtworkProps) => {
  const View = ARTWORK_VIEWS[artwork.kind]
  return <View artwork={artwork} initial={initial} sizes={sizes} />
}
