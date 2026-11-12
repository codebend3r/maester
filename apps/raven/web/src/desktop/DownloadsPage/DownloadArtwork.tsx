import { DOWNLOAD_ARTWORK_KINDS, type DownloadArtwork as Artwork } from '@raven/core'
import type { ComponentProps } from 'react'
import { coverSources } from '@/components/AlbumCover/AlbumCover'
import { Picture } from '@/components/PosterImage/PosterImage'
import { type PosterSizes, posterSources } from '@/lib/posters'
import { useDownloadsHost } from '@/stores/downloadsHost'

type Source = ComponentProps<typeof Picture>['sources'][number]

type ServerSourcesProps = { artwork: Artwork; initial: string; sizes: PosterSizes }

type ServerSources = (props: ServerSourcesProps) => Source[]

const posterOf: ServerSources = ({ artwork, sizes }) => {
  if (artwork.kind !== DOWNLOAD_ARTWORK_KINDS.poster) return []
  const source = posterSources({
    item: { id: artwork.itemId, posterVersion: artwork.version },
    sizes,
  })
  return source === null ? [] : [source]
}

const coverOf: ServerSources = ({ artwork, initial, sizes }) =>
  artwork.kind === DOWNLOAD_ARTWORK_KINDS.cover
    ? coverSources({
        album: { id: artwork.albumId, title: initial, coverVersion: artwork.version },
        sizes,
      })
    : []

/** The server's address of each kind of picture, which stands in until one is saved on disk. */
const SERVER_SOURCES = {
  [DOWNLOAD_ARTWORK_KINDS.poster]: posterOf,
  [DOWNLOAD_ARTWORK_KINDS.cover]: coverOf,
  [DOWNLOAD_ARTWORK_KINDS.none]: () => [],
} as const satisfies Record<Artwork['kind'], ServerSources>

type DownloadArtworkProps = {
  artwork: Artwork
  /** The id of the picture saved with the download, shown by its host with no server; null for none yet. */
  saved: string | null
  /** What the picture shows when there is none: the title's first letter. */
  initial: string
  sizes: PosterSizes
}

/**
 * A download's picture: the poster or album cover saved with it, else the server's, else the
 * first letter. The frame is the container's to give, as a poster's is everywhere else.
 */
export const DownloadArtwork = ({ artwork, saved, initial, sizes }: DownloadArtworkProps) => {
  const host = useDownloadsHost()
  const savedUrl = saved === null ? null : host.pictureUrl(saved)
  return (
    <Picture
      sources={[
        ...(savedUrl === null ? [] : [{ src: savedUrl }]),
        ...SERVER_SOURCES[artwork.kind]({ artwork, initial, sizes }),
      ]}
      initial={initial}
    />
  )
}
