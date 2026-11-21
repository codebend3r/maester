import type { AlbumSummary, Artist, Track } from '@raven/core'
import { api } from '@/lib/api'

/** A picture to draw: its address on the page's own origin, which the session's cookie opens. */
export type Cover = { src: string }

type CoverOfProps = Pick<AlbumSummary, 'coverVersion'> & { albumId: number }

type TrackCoverOfProps = Pick<Track, 'albumId' | 'album'>

type ArtistPhotoOfProps = Pick<Artist, 'id' | 'photoVersion'>

const pictureAt = (src: string | null): Cover | null => (src === null ? null : { src })

const coverOf = ({ albumId, coverVersion }: CoverOfProps): Cover | null =>
  pictureAt(api.albumCoverUrl({ albumId, coverVersion }))

const COVERS = {
  coverOf,
  trackCoverOf: (track: TrackCoverOfProps): Cover | null =>
    coverOf({ albumId: track.albumId, coverVersion: track.album.coverVersion }),
  artistPhotoOf: ({ id, photoVersion }: ArtistPhotoOfProps): Cover | null =>
    pictureAt(api.artistPhotoUrl({ artistId: id, photoVersion })),
} as const

/**
 * raven's pictures, as the apps' `useCovers` hands them out: an album's cover, a track's (its
 * album's) and an artist's photo, each null while the server has none. A browser asks for them
 * as plain `<img>` addresses, so there are no headers to wait for.
 */
export const useCovers = (): Covers => COVERS

/** raven's pictures, as `useCovers` hands them out. */
type Covers = typeof COVERS

export type CoverOf = Covers['coverOf']
