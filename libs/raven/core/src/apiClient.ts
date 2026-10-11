import {
  isDirectoryListing,
  isHistory,
  isItemDetails,
  isLibrary,
  isLibraryList,
  isMediaItem,
  isMediaList,
  isMediaTracks,
  isMatchCandidateList,
  isMetadataHealth,
  isPersonDetails,
  isRecord,
  isShowListing,
  isString,
  isStringArray,
} from '@/guards'
import { toQueryString } from '@/query'
import { parseWebVtt } from '@/subtitles'
import type {
  DirectoryListing,
  HistoryEntry,
  ItemDetails,
  ItemImageKind,
  Library,
  LibraryInput,
  MatchCandidate,
  MediaItem,
  MediaSort,
  MediaTracks,
  MetadataHealth,
  PersonDetails,
  ShowListing,
  StreamMode,
  SubtitleCue,
} from '@/types'

/**
 * The slice of `fetch` the client uses, spelled out structurally so this
 * library needs no DOM or Node typings: the browser's `fetch`, Node's, and
 * React Native's all satisfy it.
 */
export type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export type FetchResponse = {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>

export class ApiError extends Error {
  readonly status: number

  constructor({ status, message }: { status: number; message: string }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Nest's error body carries `message` as a string or, for validation, a list. */
const errorMessage = ({ body, fallback }: { body: unknown; fallback: string }): string => {
  if (!isRecord(body)) return fallback
  if (isString(body.message)) return body.message
  if (isStringArray(body.message)) return body.message.join(' ')
  return fallback
}

const readJson = async (response: FetchResponse): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

/**
 * Every call a client makes to the media server. `baseUrl` is '' for a web
 * app served by the server itself, or the server's origin for anything
 * running elsewhere (a native app, the Vite dev server behind a proxy).
 */
export const createApiClient = ({
  baseUrl = '',
  fetch,
}: {
  baseUrl?: string
  fetch: FetchLike
}) => {
  const root = baseUrl.replace(/\/+$/, '')
  const url = (path: string): string => `${root}${path}`

  const send = async ({
    path,
    method = 'GET',
    body,
  }: {
    path: string
    method?: string
    body?: unknown
  }): Promise<unknown> => {
    const response = await fetch(url(path), {
      method,
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : {
              accept: 'application/json',
              'content-type': 'application/json',
            },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const parsed = response.status === 204 ? null : await readJson(response)
    if (!response.ok) {
      throw new ApiError({
        status: response.status,
        message: errorMessage({ body: parsed, fallback: response.statusText || 'Request failed' }),
      })
    }
    return parsed
  }

  /** A plain-text body, such as WebVTT, failing like `send` does. */
  const sendForText = async (path: string): Promise<string> => {
    const response = await fetch(url(path), { method: 'GET', headers: { accept: 'text/vtt' } })
    if (!response.ok) {
      throw new ApiError({
        status: response.status,
        message: errorMessage({
          body: await readJson(response),
          fallback: response.statusText || 'Request failed',
        }),
      })
    }
    return response.text()
  }

  const expect = async <T>({
    request,
    guard,
  }: {
    request: Promise<unknown>
    guard: (value: unknown) => value is T
  }): Promise<T> => {
    const value = await request
    if (!guard(value)) {
      throw new ApiError({
        status: 502,
        message: 'The server sent a response this client does not understand.',
      })
    }
    return value
  }

  return {
    listLibraries: (): Promise<Library[]> =>
      expect({ request: send({ path: '/api/libraries' }), guard: isLibraryList }),

    getLibrary: (id: number): Promise<Library> =>
      expect({ request: send({ path: `/api/libraries/${id}` }), guard: isLibrary }),

    createLibrary: (input: LibraryInput): Promise<Library> =>
      expect({
        request: send({ path: '/api/libraries', method: 'POST', body: input }),
        guard: isLibrary,
      }),

    updateLibrary: ({ id, input }: { id: number; input: LibraryInput }): Promise<Library> =>
      expect({
        request: send({ path: `/api/libraries/${id}`, method: 'PUT', body: input }),
        guard: isLibrary,
      }),

    deleteLibrary: async (id: number): Promise<void> => {
      await send({ path: `/api/libraries/${id}`, method: 'DELETE' })
    },

    scanLibrary: (id: number): Promise<Library> =>
      expect({
        request: send({ path: `/api/libraries/${id}/scan`, method: 'POST' }),
        guard: isLibrary,
      }),

    /** Match again: TMDB is searched once more for the library's files no movie or show was found for. */
    matchLibrary: (id: number): Promise<Library> =>
      expect({
        request: send({ path: `/api/libraries/${id}/match`, method: 'POST' }),
        guard: isLibrary,
      }),

    /** `seed` only counts with a random sort: the same seed deals the same order. */
    listMedia: ({
      libraryId,
      search = '',
      sort = 'title',
      seed,
    }: {
      libraryId: number
      search?: string
      sort?: MediaSort
      seed?: number
    }): Promise<MediaItem[]> => {
      const query = toQueryString({
        sort,
        ...(sort === 'random' && seed !== undefined ? { seed: String(seed) } : {}),
        ...(search.trim() ? { q: search.trim() } : {}),
      })
      return expect({
        request: send({ path: `/api/libraries/${libraryId}/media?${query}` }),
        guard: isMediaList,
      })
    },

    getMedia: (id: number): Promise<MediaItem> =>
      expect({ request: send({ path: `/api/media/${id}` }), guard: isMediaItem }),

    saveProgress: async ({ id, position }: { id: number; position: number }): Promise<void> => {
      await send({ path: `/api/media/${id}/progress`, method: 'PUT', body: { position } })
    },

    setFavourite: ({ id, favourite }: { id: number; favourite: boolean }): Promise<MediaItem> =>
      expect({
        request: send({ path: `/api/media/${id}/favourite`, method: 'PUT', body: { favourite } }),
        guard: isMediaItem,
      }),

    /** Every favourite across every library, most recently favourited first. */
    listFavourites: (): Promise<MediaItem[]> =>
      expect({ request: send({ path: '/api/favourites' }), guard: isMediaList }),

    /** Notes that a video started playing, for its library's history. */
    recordPlay: async (id: number): Promise<void> => {
      await send({ path: `/api/media/${id}/plays`, method: 'POST' })
    },

    /**
     * A library's played videos by when they last played, most recent first,
     * at most `limit` of them; `watchedOnly` keeps those that count as watched.
     */
    listHistory: ({
      libraryId,
      limit,
      watchedOnly = false,
    }: {
      libraryId: number
      limit: number
      watchedOnly?: boolean
    }): Promise<HistoryEntry[]> => {
      const query = toQueryString({
        limit: String(limit),
        ...(watchedOnly ? { watched: 'true' } : {}),
      })
      return expect({
        request: send({ path: `/api/libraries/${libraryId}/history?${query}` }),
        guard: isHistory,
      })
    },

    /** Removes the file from disk and the video from its library. */
    deleteMedia: async (id: number): Promise<void> => {
      await send({ path: `/api/media/${id}`, method: 'DELETE' })
    },

    browse: (path?: string): Promise<DirectoryListing> => {
      const query = path ? `?${toQueryString({ path })}` : ''
      return expect({
        request: send({ path: `/api/fs/browse${query}` }),
        guard: isDirectoryListing,
      })
    },

    /** null until the server has generated one; versioned so it can be cached forever. */
    thumbnailUrl: (media: MediaItem): string | null =>
      media.thumbnail === 'ready'
        ? url(`/api/media/${media.id}/thumbnail?v=${media.thumbnailVersion}`)
        : null,

    /**
     * A TV shows library as shows: one entry each, with the files no show
     * was found for after. `seed` counts as it does for `listMedia`.
     */
    listShows: ({
      libraryId,
      search = '',
      sort = 'title',
      seed,
    }: {
      libraryId: number
      search?: string
      sort?: MediaSort
      seed?: number
    }): Promise<ShowListing> => {
      const query = toQueryString({
        sort,
        ...(sort === 'random' && seed !== undefined ? { seed: String(seed) } : {}),
        ...(search.trim() ? { q: search.trim() } : {}),
      })
      return expect({
        request: send({ path: `/api/libraries/${libraryId}/shows?${query}` }),
        guard: isShowListing,
      })
    },

    /** The first episode of a show not yet watched, in whichever library holds it, or null when every one is. */
    nextEpisode: (showId: number): Promise<MediaItem | null> =>
      expect({
        request: send({ path: `/api/items/${showId}/next` }),
        guard: (value): value is MediaItem | null => value === null || isMediaItem(value),
      }),

    /** Points every file under a show at another show, keeping their numbers; returns the show they moved to. */
    setItemMatch: ({ itemId, tmdbId }: { itemId: number; tmdbId: string }): Promise<ItemDetails> =>
      expect({
        request: send({ path: `/api/items/${itemId}/match`, method: 'PUT', body: { tmdbId } }),
        guard: isItemDetails,
      }),

    /** A movie, show, season or episode with everything its page shows. */
    getItem: (id: number): Promise<ItemDetails> =>
      expect({ request: send({ path: `/api/items/${id}` }), guard: isItemDetails }),

    /** Fetches an item from TMDB again now, and returns it as it stands after. */
    refreshItem: (id: number): Promise<ItemDetails> =>
      expect({
        request: send({ path: `/api/items/${id}/refresh`, method: 'POST' }),
        guard: isItemDetails,
      }),

    /** TMDB's results for Fix match. */
    searchMatches: ({
      type,
      query,
      year,
    }: {
      type: 'movie' | 'show'
      query: string
      year?: number | null
    }): Promise<MatchCandidate[]> =>
      expect({
        request: send({
          path: `/api/match/search?${toQueryString({
            type,
            query: query.trim(),
            ...(year == null ? {} : { year: String(year) }),
          })}`,
        }),
        guard: isMatchCandidateList,
      }),

    /**
     * Points a file, and every file in its folder, at a TMDB id, and keeps
     * that through renames; `null` says it is not a movie at all.
     */
    setMatch: ({
      mediaId,
      tmdbId,
    }: {
      mediaId: number
      tmdbId: string | null
    }): Promise<MediaItem> =>
      expect({
        request: send({ path: `/api/media/${mediaId}/match`, method: 'PUT', body: { tmdbId } }),
        guard: isMediaItem,
      }),

    /** How matching is doing, and whether TMDB is configured at all. */
    getMetadataHealth: async (): Promise<MetadataHealth> => {
      const health = await send({ path: '/api/health' })
      const metadata = isRecord(health) ? health.metadata : null
      if (!isMetadataHealth(metadata)) {
        throw new ApiError({
          status: 502,
          message: 'The server sent a response this client does not understand.',
        })
      }
      return metadata
    },

    /** An item's poster, backdrop or still; null when it has none. Versioned, so cached for good. */
    itemImageUrl: ({
      id,
      kind,
      version,
    }: {
      id: number
      kind: ItemImageKind
      version: string | null
    }): string | null =>
      version == null
        ? null
        : url(`/api/items/${id}/images/${kind}?${toQueryString({ v: version })}`),

    /** A person, and everything in raven they are credited on. */
    getPerson: (id: number): Promise<PersonDetails> =>
      expect({ request: send({ path: `/api/people/${id}` }), guard: isPersonDetails }),

    /** A reviewer's avatar, when TMDB hosts it. */
    reviewAvatarUrl: ({
      reviewId,
      avatarVersion,
    }: {
      reviewId: number
      avatarVersion: string | null
    }): string | null =>
      avatarVersion == null
        ? null
        : url(`/api/reviews/${reviewId}/avatar?${toQueryString({ v: avatarVersion })}`),

    /** A person's photo; null when TMDB has none. */
    photoUrl: ({
      personId,
      photoVersion,
    }: {
      personId: number
      photoVersion: string | null
    }): string | null =>
      photoVersion == null
        ? null
        : url(`/api/people/${personId}/photo?${toQueryString({ v: photoVersion })}`),

    /** A Fix match result's poster, through the server's image cache. */
    candidatePosterUrl: (poster: string | null): string | null =>
      poster == null ? null : url(`/api/images/poster${poster}`),

    /** The original file, served with byte ranges: what a player loads for direct play. */
    fileUrl: (mediaId: number): string => url(`/api/media/${mediaId}/file`),

    /** The audio and subtitle tracks a player can choose between. */
    getTracks: (id: number): Promise<MediaTracks> =>
      expect({ request: send({ path: `/api/media/${id}/tracks` }), guard: isMediaTracks }),

    /**
     * One subtitle track's cues. Embedded tracks come a window at a time
     * (see `subtitleWindows`); sidecar files come whole and ignore `window`.
     */
    getSubtitles: async ({
      id,
      trackId,
      window = 0,
    }: {
      id: number
      trackId: string
      window?: number
    }): Promise<SubtitleCue[]> =>
      parseWebVtt(
        await sendForText(
          `/api/media/${id}/subtitles/${encodeURIComponent(trackId)}?${toQueryString({ window: String(window) })}`,
        ),
      ),

    /**
     * A converted stream as fragmented MP4, starting at `start` seconds into
     * the file and stamped with file time plus `STREAM_TIME_SHIFT`. `audio`
     * picks the track by its `0:a:N` index; left out, the default plays.
     */
    streamUrl: ({
      id,
      mode,
      start,
      audio,
    }: {
      id: number
      mode: StreamMode
      start: number
      audio: number | null
    }): string =>
      url(
        `/api/media/${id}/stream?${toQueryString({
          mode,
          start: String(Math.max(0, Math.round(start * 1000) / 1000)),
          ...(audio == null ? {} : { audio: String(audio) }),
        })}`,
      ),
  }
}
