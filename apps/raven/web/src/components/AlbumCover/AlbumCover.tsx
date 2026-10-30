import type { AlbumSummary } from '@raven/core'
import { api } from '@/lib/api'
import type { PosterSizes } from '@/lib/posters'
import { Picture } from '@/components/PosterImage/PosterImage'

type AlbumCoverProps = {
  album: Pick<AlbumSummary, 'id' | 'title' | 'coverVersion'>
  /** How wide the list holding the cover shows it, as `posterSources` reads sizes. */
  sizes: PosterSizes
}

type CoverSourcesProps = AlbumCoverProps

/** The cover's one source, with its widths when the server scales it; none when it has no cover. */
const coverSources = ({ album, sizes }: CoverSourcesProps) => {
  const src = api.albumCoverUrl({ albumId: album.id, coverVersion: album.coverVersion })
  const srcSet = api.albumCoverSrcSet({ albumId: album.id, coverVersion: album.coverVersion })
  if (src === null) return []
  if (srcSet === null) return [{ src }]
  return [{ src, srcSet, sizes }]
}

/** An album's cover at the width it shows, else the album's initial; the frame is the container's. */
export const AlbumCover = ({ album, sizes }: AlbumCoverProps) => (
  <Picture sources={coverSources({ album, sizes })} initial={album.title.slice(0, 1)} />
)
