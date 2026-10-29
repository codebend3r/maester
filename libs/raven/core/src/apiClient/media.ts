import type { Transport } from '@/apiClient/transport'
import {
  type FavouriteChange,
  isMediaItem,
  isMediaLocation,
  isMediaMarkers,
  type MediaItem,
  type MediaLocation,
  type MediaMarkers,
  type ProgressReport,
  type ViewingSession,
  type WatchedChange,
  sessionQueryOf,
} from '@/contract'
import { toQueryString } from '@/query'
import { nullable } from '@/schema'

type SaveProgressProps = { id: number } & ProgressReport

type SetFavouriteProps = { id: number; favourite: boolean }

type NextInSessionProps = { id: number; session: ViewingSession }

/** One video: what it is, where it is, and the viewer's own marks on it. */
export const mediaCalls = ({ send, expect }: Transport) => ({
  getMedia: (id: number): Promise<MediaItem> =>
    expect({ request: send({ path: `/api/media/${id}` }), guard: isMediaItem }),

  /** What plays after video `id` in `session`, in the same library; null at the session's end. */
  nextInSession: ({ id, session }: NextInSessionProps): Promise<MediaItem | null> =>
    expect({
      request: send({ path: `/api/media/${id}/next?${toQueryString(sessionQueryOf(session))}` }),
      guard: nullable(isMediaItem),
    }),

  /** The video's intro, credits and chapters, as far as the server knows them. */
  getMarkers: (id: number): Promise<MediaMarkers> =>
    expect({ request: send({ path: `/api/media/${id}/markers` }), guard: isMediaMarkers }),

  /** Where the video's file lives; listings leave the path out. */
  getMediaLocation: (id: number): Promise<MediaLocation> =>
    expect({ request: send({ path: `/api/media/${id}/location` }), guard: isMediaLocation }),

  /** Where playback got to, and the audio track playing, for the admin's Streams page. */
  saveProgress: async ({ id, position, audio }: SaveProgressProps): Promise<void> => {
    await send({
      path: `/api/media/${id}/progress`,
      method: 'PUT',
      body: { position, audio } satisfies ProgressReport,
    })
  },

  setFavourite: ({ id, favourite }: SetFavouriteProps): Promise<MediaItem> =>
    expect({
      request: send({
        path: `/api/media/${id}/favourite`,
        method: 'PUT',
        body: { favourite } satisfies FavouriteChange,
      }),
      guard: isMediaItem,
    }),

  /** Marks every target watched or unwatched; a target in a library this browser may not see is skipped. */
  setWatched: async ({ watched, targets }: WatchedChange): Promise<void> => {
    await send({
      path: '/api/watched',
      method: 'PUT',
      body: { watched, targets } satisfies WatchedChange,
    })
  },

  /** Notes that a video started playing, for its library's history. */
  recordPlay: async (id: number): Promise<void> => {
    await send({ path: `/api/media/${id}/plays`, method: 'POST' })
  },

  /** Removes the file from disk and the video from its library. */
  deleteMedia: async (id: number): Promise<void> => {
    await send({ path: `/api/media/${id}`, method: 'DELETE' })
  },
})
