import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type FavouriteChange,
  type MediaItem,
  type MediaLocation,
  type MediaMarkers,
  type ProgressReport,
  type ViewingSession,
  type WatchedChange,
  sessionQueryOf,
} from '@/contract'

type SaveProgressProps = { id: number } & ProgressReport

type SetFavouriteProps = { id: number; favourite: boolean }

type NextInSessionProps = { id: number; session: ViewingSession }

/** One video: what it is, where it is, and the viewer's own marks on it. */
export const mediaCalls = ({ ask, tell }: Transport) => ({
  getMedia: (id: number): Promise<MediaItem> => ask({ route: ROUTES.getMedia, params: { id } }),

  /** What plays after video `id` in `session`, in the same library; null at the session's end. */
  nextInSession: ({ id, session }: NextInSessionProps): Promise<MediaItem | null> =>
    ask({ route: ROUTES.nextInSession, params: { id }, query: sessionQueryOf(session) }),

  /** The video's intro, credits and chapters, as far as the server knows them. */
  getMarkers: (id: number): Promise<MediaMarkers> =>
    ask({ route: ROUTES.getMarkers, params: { id } }),

  /** Where the video's file lives; listings leave the path out. */
  getMediaLocation: (id: number): Promise<MediaLocation> =>
    ask({ route: ROUTES.getMediaLocation, params: { id } }),

  /** Where playback got to, and the audio track playing, for the admin's Streams page. */
  saveProgress: async ({ id, position, audio }: SaveProgressProps): Promise<void> => {
    await tell({
      route: ROUTES.saveProgress,
      params: { id },
      body: { position, audio } satisfies ProgressReport,
    })
  },

  setFavourite: ({ id, favourite }: SetFavouriteProps): Promise<MediaItem> =>
    ask({
      route: ROUTES.setFavourite,
      params: { id },
      body: { favourite } satisfies FavouriteChange,
    }),

  /** Marks every target watched or unwatched; a target in a library this browser may not see is skipped. */
  setWatched: async ({ watched, targets }: WatchedChange): Promise<void> => {
    await tell({ route: ROUTES.setWatched, body: { watched, targets } satisfies WatchedChange })
  },

  /** Notes that a video started playing, for its library's history. */
  recordPlay: async (id: number): Promise<void> => {
    await tell({ route: ROUTES.recordPlay, params: { id } })
  },

  /** Removes the file from disk and the video from its library. */
  deleteMedia: async (id: number): Promise<void> => {
    await tell({ route: ROUTES.deleteMedia, params: { id } })
  },
})
