import {
  type AdminLock,
  type AdminUnlockRequest,
  type ChoosableImageKind,
  type DirectoryListing,
  type DisplaySettings,
  type DisplaySettingsChange,
  type Duplicates,
  type FavouriteChange,
  type WatchedChange,
  type HistoryEntry,
  type Home,
  type HomeSearch,
  type ImageChoice,
  type ImageOption,
  type ItemDetails,
  type ItemImageKind,
  type ItemImageOptions,
  type ItemMetadataChange,
  type ItemMetadataState,
  type JoinRequest,
  type Library,
  type LibraryBackdrop,
  type LibraryInput,
  type LibraryViewChange,
  type LockState,
  type MatchCandidate,
  type MatchChoice,
  type MatchItemType,
  type MatchSubject,
  type MediaItem,
  type UnmatchedFile,
  type MediaLocation,
  type MediaOrigin,
  type MediaOrigins,
  type MediaTicket,
  type MediaStreams,
  type MediaTracks,
  type MetadataHealth,
  type PersonDetails,
  type PlaybackSettings,
  type PlaybackSettingsState,
  type PosterEntry,
  type ProgressChange,
  type Saga,
  type SagaBackdrop,
  type ServerEvent,
  type ShowListing,
  type ShowMatchChoice,
  type SplitRequest,
  type StreamMode,
  type SubtitleCue,
  type UnlockRequest,
  isAdminLock,
  isDirectoryListing,
  isDisplaySettings,
  isDuplicates,
  isHistory,
  isHome,
  isHomeSearch,
  isItemDetails,
  isItemImageOptions,
  isItemMetadataState,
  isLibrary,
  isLibraryList,
  isLockState,
  isMatchCandidateList,
  isUnmatchedList,
  isMediaItem,
  isMediaList,
  isMediaLocation,
  isMediaOrigins,
  isMediaStreams,
  isMediaTicket,
  isMediaTracks,
  isPersonDetails,
  isPlaybackSettingsState,
  isPosterEntries,
  MEDIA_PROBE_BYTES,
  POSTER_OWN_WIDTH,
  POSTER_WIDTHS,
  isSagaBackdrop,
  isSagaList,
  isServerEvent,
  isServerHealth,
  isShowListing,
} from '@/contract'
import { type MediaListOptions, mediaListQuery } from '@/mediaListQuery'
import { toQueryString } from '@/query'
import type { SagaPicture } from '@/sagas'
import { type Guard, isRecord, isString, isStringArray, nullable } from '@/schema'
import { parseWebVtt } from '@/subtitles'

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

/** A media origin and the ticket that opens a video on it, which stands in for the cookie. */
export type MediaAccess = { origin: MediaOrigin; ticket: string }

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>

export class ApiError extends Error {
  readonly status: number

  constructor({ status, message }: { status: number; message: string }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** HTTP's Locked: what the server answers for a locked library's videos until its PIN is entered. */
export const LOCKED_STATUS = 423

/** A call refused because what it asked for sits in a locked library. */
export const isLockedError = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === LOCKED_STATUS

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

/** One message off the server's event stream, or null for anything this client does not know. */
export const parseServerEvent = (data: string): ServerEvent | null => {
  try {
    const parsed: unknown = JSON.parse(data)
    return isServerEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The query a search's subject adds: the file, or the show, it is scored against. */
const subjectQuery = (subject: MatchSubject | null): Record<string, string> => {
  if (subject == null) return {}
  switch (subject.kind) {
    case 'media':
      return { mediaId: String(subject.id) }
    case 'item':
      return { itemId: String(subject.id) }
    default: {
      const unreachable: never = subject
      return unreachable
    }
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

  /** A media path on the origin `access` names, with its ticket; on this server's own without. */
  const mediaUrl = ({
    path,
    query,
    access,
  }: {
    path: string
    query: Record<string, string>
    access: MediaAccess | null
  }): string => {
    const queryString = toQueryString(access === null ? query : { ...query, t: access.ticket })
    return `${access === null ? root : access.origin.url}${path}${queryString === '' ? '' : `?${queryString}`}`
  }

  /** Calls the server, failing with its own message when it says no. */
  const call = async ({
    path,
    href = url(path),
    method = 'GET',
    accept = 'application/json',
    body,
  }: {
    path: string
    /** A full address, for the media origins; `path` is then unused. */
    href?: string
    method?: string
    accept?: string
    body?: unknown
  }): Promise<FetchResponse> => {
    const response = await fetch(href, {
      method,
      headers: body === undefined ? { accept } : { accept, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      throw new ApiError({
        status: response.status,
        message: errorMessage({
          body: await readJson(response),
          fallback: response.statusText || 'Request failed',
        }),
      })
    }
    return response
  }

  const send = async (request: {
    path: string
    method?: string
    body?: unknown
  }): Promise<unknown> => {
    const response = await call(request)
    return response.status === 204 ? null : readJson(response)
  }

  /** A plain-text body, such as WebVTT. */
  const sendForText = async (href: string): Promise<string> =>
    (await call({ path: '', href, accept: 'text/vtt' })).text()

  const expect = async <T>({
    request,
    guard,
  }: {
    request: Promise<unknown>
    guard: Guard<T>
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

  /** One of a library's lists, read at `path` under it. */
  const libraryGet = <T>({
    libraryId,
    path,
    guard,
  }: {
    libraryId: number
    path: string
    guard: Guard<T>
  }): Promise<T> =>
    expect({ request: send({ path: `/api/libraries/${libraryId}/${path}` }), guard })

  /** A video's thumbnail at `version`, which it changes with, so it can be cached for good. */
  const thumbnailAt = ({ id, version }: { id: number; version: number }): string =>
    url(`/api/media/${id}/thumbnail?v=${version}`)

  /** An item's picture of `kind` at `version`, which it changes with, so it can be cached for good. */
  const itemImageAt = ({
    id,
    kind,
    version,
  }: {
    id: number
    kind: ItemImageKind
    version: string
  }): string => url(`/api/items/${id}/images/${kind}?${toQueryString({ v: version })}`)

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

    /** How a library is laid out, or its pin: what any viewer may change, the admin lock on or off. */
    setLibraryView: ({ id, change }: { id: number; change: LibraryViewChange }): Promise<Library> =>
      expect({
        request: send({ path: `/api/libraries/${id}/view`, method: 'PUT', body: change }),
        guard: isLibrary,
      }),

    deleteLibrary: async (id: number): Promise<void> => {
      await send({ path: `/api/libraries/${id}`, method: 'DELETE' })
    },

    getLock: (): Promise<LockState> =>
      expect({ request: send({ path: '/api/lock' }), guard: isLockState }),

    /** Opens every locked library for this browser; a wrong PIN fails with the server's reason. */
    unlock: (pin: string): Promise<LockState> =>
      expect({
        request: send({
          path: '/api/lock/unlock',
          method: 'POST',
          body: { pin } satisfies UnlockRequest,
        }),
        guard: isLockState,
      }),

    /** Closes the locked libraries again. */
    lock: (): Promise<LockState> =>
      expect({ request: send({ path: '/api/lock/lock', method: 'POST' }), guard: isLockState }),

    getAdminLock: (): Promise<AdminLock> =>
      expect({ request: send({ path: '/api/admin' }), guard: isAdminLock }),

    /** Turns the admin lock off in this browser; a wrong password fails with the server's reason. */
    unlockAdmin: (password: string): Promise<AdminLock> =>
      expect({
        request: send({
          path: '/api/admin/unlock',
          method: 'POST',
          body: { password } satisfies AdminUnlockRequest,
        }),
        guard: isAdminLock,
      }),

    /** Turns the admin lock back on, after a short wait in which `keepAdminUnlocked` undoes it. */
    lockAdmin: (): Promise<AdminLock> =>
      expect({ request: send({ path: '/api/admin/lock', method: 'POST' }), guard: isAdminLock }),

    /** Takes back a `lockAdmin` that has yet to hold, with no password; fails once it holds. */
    keepAdminUnlocked: (): Promise<AdminLock> =>
      expect({
        request: send({ path: '/api/admin/keep-unlocked', method: 'POST' }),
        guard: isAdminLock,
      }),

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
      ...options
    }: { libraryId: number } & MediaListOptions): Promise<MediaItem[]> =>
      expect({
        request: send({
          path: `/api/libraries/${libraryId}/media?${mediaListQuery.encode(options)}`,
        }),
        guard: isMediaList,
      }),

    getMedia: (id: number): Promise<MediaItem> =>
      expect({ request: send({ path: `/api/media/${id}` }), guard: isMediaItem }),

    /** Where the video's file lives; listings leave the path out. */
    getMediaLocation: (id: number): Promise<MediaLocation> =>
      expect({ request: send({ path: `/api/media/${id}/location` }), guard: isMediaLocation }),

    saveProgress: async ({ id, position }: { id: number; position: number }): Promise<void> => {
      await send({
        path: `/api/media/${id}/progress`,
        method: 'PUT',
        body: { position } satisfies ProgressChange,
      })
    },

    setFavourite: ({ id, favourite }: { id: number; favourite: boolean }): Promise<MediaItem> =>
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

    /** Every favourite across every library with the poster its card shows, most recently favourited first. */
    listFavourites: (): Promise<PosterEntry[]> =>
      expect({ request: send({ path: '/api/favourites' }), guard: isPosterEntries }),

    /** A library's videos with a saved spot, the most recently watched first, each with its poster. */
    listInProgress: (libraryId: number): Promise<PosterEntry[]> =>
      libraryGet({ libraryId, path: 'in-progress', guard: isPosterEntries }),

    /** A library's favourites, most recently marked first, each with its poster. */
    listLibraryFavourites: (libraryId: number): Promise<PosterEntry[]> =>
      libraryGet({ libraryId, path: 'favourites', guard: isPosterEntries }),

    /** A movie library's sagas of two movies or more, by name, each oldest first. */
    listSagas: (libraryId: number): Promise<Saga[]> =>
      libraryGet({ libraryId, path: 'sagas', guard: isSagaList }),

    /** Picks what a saga's page shows behind its title; answers with what was saved. */
    setSagaBackdrop: ({
      libraryId,
      sagaId,
      backdrop,
    }: {
      libraryId: number
      sagaId: Saga['tmdbId']
      backdrop: SagaBackdrop
    }): Promise<SagaBackdrop> =>
      expect({
        request: send({
          path: `/api/libraries/${libraryId}/sagas/${encodeURIComponent(sagaId)}/backdrop`,
          method: 'PUT',
          body: backdrop,
        }),
        guard: isSagaBackdrop,
      }),

    /** A library's files no movie or show was found for, each with the AI lookup's suggestion for its folder. */
    listUnmatched: (libraryId: number): Promise<UnmatchedFile[]> =>
      libraryGet({ libraryId, path: 'unmatched', guard: isUnmatchedList }),

    /** A movie library's movies with more than one file, each with its cards, split apart or not. */
    listDuplicates: (libraryId: number): Promise<Duplicates> =>
      libraryGet({ libraryId, path: 'duplicates', guard: isDuplicates }),

    /** Splits the card `mediaId` is on, every file apart or by cut; answers with the duplicates as they stand after. */
    splitDuplicate: ({
      libraryId,
      mediaId,
      how,
    }: { libraryId: number } & SplitRequest): Promise<Duplicates> =>
      expect({
        request: send({
          path: `/api/libraries/${libraryId}/duplicates/split`,
          method: 'POST',
          body: { mediaId, how } satisfies SplitRequest,
        }),
        guard: isDuplicates,
      }),

    /** Puts a movie's files back on one card; answers with the duplicates as they stand after. */
    joinSplit: ({ libraryId, itemId }: { libraryId: number } & JoinRequest): Promise<Duplicates> =>
      expect({
        request: send({
          path: `/api/libraries/${libraryId}/duplicates/join`,
          method: 'POST',
          body: { itemId } satisfies JoinRequest,
        }),
        guard: isDuplicates,
      }),

    /** Every video in progress, then each pinned library's newest arrivals; libraries still locked stay out. */
    getHome: (): Promise<Home> => expect({ request: send({ path: '/api/home' }), guard: isHome }),

    /** What `query` finds in every library, a row for each holding a match; libraries still locked stay out. */
    searchHome: (query: string): Promise<HomeSearch> =>
      expect({
        request: send({ path: `/api/home/search?${toQueryString({ q: query.trim() })}` }),
        guard: isHomeSearch,
      }),

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
        ? thumbnailAt({ id: media.id, version: media.thumbnailVersion })
        : null,

    /**
     * A TV shows library as shows: one entry each, with the files no show
     * was found for after. `seed` counts as it does for `listMedia`.
     */
    listShows: ({
      libraryId,
      ...options
    }: { libraryId: number } & MediaListOptions): Promise<ShowListing> =>
      expect({
        request: send({
          path: `/api/libraries/${libraryId}/shows?${mediaListQuery.encode(options)}`,
        }),
        guard: isShowListing,
      }),

    /** The first episode of a show not yet watched, in whichever library holds it, or null when every one is. */
    nextEpisode: (showId: number): Promise<MediaItem | null> =>
      expect({
        request: send({ path: `/api/items/${showId}/next` }),
        guard: nullable(isMediaItem),
      }),

    /** A random episode of a show or a season, in whichever library holds it, or null with none to play. */
    randomEpisode: (itemId: number): Promise<MediaItem | null> =>
      expect({
        request: send({ path: `/api/items/${itemId}/random` }),
        guard: nullable(isMediaItem),
      }),

    /** Points every file under a show at another show, keeping their numbers; returns the show they moved to. */
    setItemMatch: ({ itemId, tmdbId }: { itemId: number; tmdbId: string }): Promise<ItemDetails> =>
      expect({
        request: send({
          path: `/api/items/${itemId}/match`,
          method: 'PUT',
          body: { tmdbId } satisfies ShowMatchChoice,
        }),
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

    /**
     * TMDB's results for Fix match, best first by confidence, scored against
     * what `subject` has on disk; `libraryId`'s type comes first among equals.
     */
    searchMatches: ({
      type,
      query,
      year,
      libraryId,
      subject = null,
    }: {
      type: MatchItemType
      query: string
      year?: number | null
      libraryId?: number | null
      /** The file or show the search is for, which its results are scored against. */
      subject?: MatchSubject | null
    }): Promise<MatchCandidate[]> =>
      expect({
        request: send({
          path: `/api/match/search?${toQueryString({
            type,
            query: query.trim(),
            ...(year == null ? {} : { year: String(year) }),
            ...(libraryId == null ? {} : { libraryId: String(libraryId) }),
            ...subjectQuery(subject),
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
        request: send({
          path: `/api/media/${mediaId}/match`,
          method: 'PUT',
          body: { tmdbId } satisfies MatchChoice,
        }),
        guard: isMediaItem,
      }),

    /** How matching is doing, and whether TMDB is configured at all. */
    getMetadataHealth: async (): Promise<MetadataHealth> =>
      (await expect({ request: send({ path: '/api/health' }), guard: isServerHealth })).metadata,

    /** An item's poster, backdrop or still; null when it has none. Versioned, so cached for good. */
    itemImageUrl: ({
      id,
      kind,
      version,
    }: {
      id: number
      kind: ItemImageKind
      version: string | null
    }): string | null => (version == null ? null : itemImageAt({ id, kind, version })),

    /**
     * An item's poster at each width it comes in, for an `img`'s `srcset`;
     * null when it has none. The widest is `itemImageUrl`'s own URL, so a
     * card that shows it and the item's page share one download.
     */
    posterSrcSet: ({ id, version }: { id: number; version: string | null }): string | null => {
      if (version == null) return null
      // Built once and widened by hand: a library lists thousands of posters.
      const own = itemImageAt({ id, kind: 'poster', version })
      return POSTER_WIDTHS.map((width) =>
        width === POSTER_OWN_WIDTH ? `${own} ${width}w` : `${own}&w=${width} ${width}w`,
      ).join(', ')
    },

    /** One of a saga's movies' backdrops; versioned, so cached for good. */
    sagaPictureUrl: (picture: SagaPicture): string =>
      itemImageAt({ id: picture.id, kind: 'backdrop', version: picture.version }),

    /** The picture behind a library's row on the Libraries page; versioned, so cached for good. */
    libraryBackdropUrl: (backdrop: LibraryBackdrop): string => {
      switch (backdrop.type) {
        case 'item':
          return itemImageAt({ id: backdrop.id, kind: 'backdrop', version: backdrop.version })
        case 'thumbnail':
          return thumbnailAt({ id: backdrop.id, version: backdrop.version })
        default: {
          const unknown: never = backdrop
          return unknown
        }
      }
    },

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

    /** How the server plays video, and what that comes to on this machine. */
    getPlaybackSettings: (): Promise<PlaybackSettingsState> =>
      expect({
        request: send({ path: '/api/settings/playback' }),
        guard: isPlaybackSettingsState,
      }),

    /** Changes one or more playback settings; the rest stay as they are. */
    setPlaybackSettings: (change: Partial<PlaybackSettings>): Promise<PlaybackSettingsState> =>
      expect({
        request: send({ path: '/api/settings/playback', method: 'PUT', body: change }),
        guard: isPlaybackSettingsState,
      }),

    /** How pages look for every viewer: whether a movie's title shows as its logo. */
    getDisplaySettings: (): Promise<DisplaySettings> =>
      expect({ request: send({ path: '/api/settings/display' }), guard: isDisplaySettings }),

    /** Changes one or more display settings; the rest stay as they are. */
    setDisplaySettings: (change: DisplaySettingsChange): Promise<DisplaySettings> =>
      expect({
        request: send({ path: '/api/settings/display', method: 'PUT', body: change }),
        guard: isDisplaySettings,
      }),

    /** Edit metadata: what the page shows, what TMDB says, and which fields were written over. */
    getItemMetadata: (id: number): Promise<ItemMetadataState> =>
      expect({
        request: send({ path: `/api/items/${id}/metadata` }),
        guard: isItemMetadataState,
      }),

    /** Edit metadata: writes the fields given over TMDB's, or clears each sent as null. */
    setItemMetadata: ({
      id,
      change,
    }: {
      id: number
      change: ItemMetadataChange
    }): Promise<ItemDetails> =>
      expect({
        request: send({ path: `/api/items/${id}/metadata`, method: 'PUT', body: change }),
        guard: isItemDetails,
      }),

    /** Every poster and backdrop a movie or show could show, the current one marked. */
    getItemImages: (id: number): Promise<ItemImageOptions> =>
      expect({ request: send({ path: `/api/items/${id}/images` }), guard: isItemImageOptions }),

    /** Edit images: the item shows `choice` for `kind` from now on; refreshes keep it. */
    chooseItemImage: ({
      id,
      kind,
      choice,
    }: {
      id: number
      kind: ChoosableImageKind
      choice: ImageChoice
    }): Promise<ItemDetails> =>
      expect({
        request: send({ path: `/api/items/${id}/images/${kind}`, method: 'PUT', body: choice }),
        guard: isItemDetails,
      }),

    /** A picture Edit images offers, through the server's cache (TMDB's) or scaled (a local one). */
    imageOptionUrl: ({
      id,
      kind,
      option,
    }: {
      id: number
      kind: ChoosableImageKind
      option: ImageOption
    }): string =>
      option.source === 'local'
        ? url(`/api/items/${id}/images/${kind}/local`)
        : url(`/api/images/${kind}${option.ref}`),

    /** The original file, served with byte ranges: what a player loads for direct play. */
    fileUrl: ({ id, access = null }: { id: number; access?: MediaAccess | null }): string =>
      mediaUrl({ path: `/api/media/${id}/file`, query: {}, access }),

    /** The server's event stream: `ServerEvent`s, read with `parseServerEvent`. */
    eventsUrl: (): string => url('/api/events'),

    /** The audio and subtitle tracks a player can choose between. */
    getTracks: (id: number): Promise<MediaTracks> =>
      expect({ request: send({ path: `/api/media/${id}/tracks` }), guard: isMediaTracks }),

    /** The file's picture and sound in detail, probed afresh each time: profiles, bitrates, sample rates. */
    getStreams: (id: number): Promise<MediaStreams> =>
      expect({ request: send({ path: `/api/media/${id}/streams` }), guard: isMediaStreams }),

    /** The origins a browser may fetch media from directly, best first; none while tickets are off. */
    getMediaOrigins: (): Promise<MediaOrigins> =>
      expect({ request: send({ path: '/api/media-origins' }), guard: isMediaOrigins }),

    /** A short-lived ticket that stands in for the cookie on this video's media requests to another origin. */
    getMediaTicket: (id: number): Promise<MediaTicket> =>
      expect({ request: send({ path: `/api/media/${id}/ticket` }), guard: isMediaTicket }),

    /** The address of `origin`'s speed probe: `bytes` of noise, never from disk. */
    pingUrl: ({
      origin,
      bytes = MEDIA_PROBE_BYTES,
    }: {
      origin: MediaOrigin
      bytes?: number
    }): string => `${origin.url}/api/media-origins/ping?bytes=${bytes}`,

    /**
     * One subtitle track's cues. Embedded tracks come a window at a time
     * (see `subtitleWindows`); sidecar files come whole and ignore `window`.
     */
    getSubtitles: async ({
      id,
      trackId,
      window = 0,
      access = null,
    }: {
      id: number
      trackId: string
      window?: number
      access?: MediaAccess | null
    }): Promise<SubtitleCue[]> =>
      parseWebVtt(
        await sendForText(
          mediaUrl({
            path: `/api/media/${id}/subtitles/${encodeURIComponent(trackId)}`,
            query: { window: String(window) },
            access,
          }),
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
      access = null,
    }: {
      id: number
      mode: StreamMode
      start: number
      audio: number | null
      access?: MediaAccess | null
    }): string =>
      mediaUrl({
        path: `/api/media/${id}/stream`,
        query: {
          mode,
          start: String(Math.max(0, Math.round(start * 1000) / 1000)),
          ...(audio == null ? {} : { audio: String(audio) }),
        },
        access,
      }),
  }
}
