import type { AlbumSummary, Artist, Track } from '@raven/core'
import { cookieJar } from '@raven/native'
import { serverHeadersFor } from '@raven/native/headless'

import { useWrenAccount } from '@/session'
import type { WrenSession } from '@/useWren'

/** A cover to draw: where it is, and the headers its request carries. */
export type Cover = { uri: string; headers: Record<string, string> }

type CoverOfProps = Pick<AlbumSummary, 'coverVersion'> & { albumId: number }

const useServerHeaders = serverHeadersFor({ session: useWrenAccount, jar: cookieJar })

type UseCoversProps = Pick<WrenSession, 'server' | 'api'>

type TrackCoverOfProps = Pick<Track, 'albumId' | 'album'>

type ArtistPhotoOfProps = Pick<Artist, 'id' | 'photoVersion'>

/**
 * The active server's pictures, each with the server's cookies and the account's token on its
 * request: an album's cover, a track's (its album's), and an artist's photo. None has one until
 * the jar has first answered, so no picture is asked for twice, and an artist with no photo
 * yet never builds an address.
 */
export const useCovers = ({ server, api }: UseCoversProps) => {
  const headersFor = useServerHeaders({ server })
  const pictureAt = (uri: string | null): Cover | null =>
    uri === null || headersFor === null ? null : { uri, headers: headersFor(uri) }
  const coverOf = ({ albumId, coverVersion }: CoverOfProps): Cover | null =>
    pictureAt(api.albumCoverUrl({ albumId, coverVersion }))
  return {
    coverOf,
    trackCoverOf: (track: TrackCoverOfProps): Cover | null =>
      coverOf({ albumId: track.albumId, coverVersion: track.album.coverVersion }),
    artistPhotoOf: ({ id, photoVersion }: ArtistPhotoOfProps): Cover | null =>
      photoVersion === null ? null : pictureAt(api.artistPhotoUrl({ artistId: id, photoVersion })),
  }
}

/** The active server's pictures, as `useCovers` hands them out. */
export type Covers = ReturnType<typeof useCovers>

export type CoverOf = Covers['coverOf']
