import type { AlbumSummary } from '@raven/core'
import { api } from '@/lib/api'
import type { PosterSizes } from '@/lib/posters'
import { Picture } from '@/components/PosterImage/PosterImage'

type AlbumCoverProps = {
  album: Pick<AlbumSummary, 'id' | 'title' | 'coverVersion'>
  /** How wide the list holding the cover shows it, as `posterSources` reads sizes. */
  sizes: PosterSizes
}

/** An album's cover at the width it shows, else the album's initial; the frame is the container's. */
export const AlbumCover = ({ album, sizes }: AlbumCoverProps) => {
  const src = api.albumCoverUrl({ albumId: album.id, coverVersion: album.coverVersion })
  const srcSet = api.albumCoverSrcSet({ albumId: album.id, coverVersion: album.coverVersion })
  return (
    <Picture
      sources={src === null ? [] : [srcSet === null ? { src } : { src, srcSet, sizes }]}
      initial={album.title.slice(0, 1)}
    />
  )
}
