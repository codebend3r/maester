import {
  isDirectoryListing,
  isLibrary,
  isLibraryList,
  isMediaItem,
  isMediaList,
  isRecord,
  isString,
  isStringArray,
} from './guards.js'
import { toQueryString } from './query.js'
import type { DirectoryListing, Library, LibraryInput, MediaItem, MediaSort } from './types.js'

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

    listMedia: ({
      libraryId,
      search = '',
      sort = 'title',
    }: {
      libraryId: number
      search?: string
      sort?: MediaSort
    }): Promise<MediaItem[]> => {
      const query = toQueryString({ sort, ...(search.trim() ? { q: search.trim() } : {}) })
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

    /** The original file, served with byte ranges: what a player loads for direct play. */
    fileUrl: (mediaId: number): string => url(`/api/media/${mediaId}/file`),
  }
}
