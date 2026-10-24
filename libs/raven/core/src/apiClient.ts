import {
  type AdminLock,
  type Account,
  type AuthConfig,
  type AuthRefusal,
  type MemberStatusChange,
  AUTH_HEADERS,
  AUTH_API_PREFIX,
  AUTH_METHODS,
  AUTH_PARAMS,
  AUTH_PATHS,
  AUTH_SCHEME,
  BUG_REPORT_PARAMS,
  BUG_REPORT_PATHS,
  type BugReport,
  type BugReportStatus,
  type BugReportStatusChange,
  type PlaybackDiagnostics,
  isBugReport,
  isBugReportList,
  MEDIA_TICKET_PARAM,
  isAccount,
  isAccountList,
  isAuthConfig,
  isAuthRefusal,
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
  type ItemSummary,
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
  type PosterWidth,
  type ProgressReport,
  type Saga,
  type SagaBackdrop,
  type ServerEvent,
  type ShowListing,
  type ShowMatchChoice,
  type SplitRequest,
  type LiveStream,
  type StreamMode,
  type StreamQuality,
  type SubtitleCue,
  type UnlockRequest,
  HLS_PARAMS,
  HLS_PATHS,
  IMAGE_SOURCES,
  ITEM_IMAGE_KINDS,
  LIBRARY_BACKDROP_TYPES,
  MATCH_SUBJECT_KINDS,
  THUMBNAIL_STATES,
  isAdminLock,
  isDirectoryListing,
  isDisplaySettings,
  isDuplicates,
  isHistory,
  isHome,
  isHomeSearch,
  isFavouriteTitles,
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
  isLiveStreamList,
  isMediaTracks,
  isPersonDetails,
  isPlaybackSettingsState,
  isPosterEntries,
  MEDIA_PROBE_BYTES,
  BACKDROP_OWN_WIDTH,
  CDN_BACKDROP_WIDTHS,
  CDN_POSTER_WIDTHS,
  PICTURE_PARAMS,
  PICTURE_PATHS,
  POSTER_OWN_WIDTH,
  POSTER_WIDTHS,
  isSagaBackdrop,
  isSagaList,
  isServerEvent,
  isServerHealth,
  isShowListing,
} from '@/contract'
import { isUnreachableAnswer } from '@/desktop/webHost'
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
  readonly refusal: AuthRefusal | null
  /** Whether the answer came from in front of a server out of reach (see `isUnreachableAnswer`). */
  readonly isServerUnreachable: boolean

  constructor({
    status,
    message,
    refusal = null,
    isServerUnreachable = false,
  }: {
    status: number
    message: string
    refusal?: AuthRefusal | null
    isServerUnreachable?: boolean
  }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.refusal = refusal
    this.isServerUnreachable = isServerUnreachable
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
    case MATCH_SUBJECT_KINDS.media:
      return { mediaId: String(subject.id) }
    case MATCH_SUBJECT_KINDS.item:
      return { itemId: String(subject.id) }
    default: {
      const unreachable: never = subject
      return unreachable
    }
  }
}

/**
 * The capability address of an item's picture of `kind` at `version`,
 * which it changes with, so it can be cached for good, by anyone.
 */
const itemPicturePath = ({
  id,
  kind,
  version,
}: {
  id: number
  kind: ItemImageKind
  version: string
}): string =>
  PICTURE_PATHS.item
    .replace(`:${PICTURE_PARAMS.id}`, String(id))
    .replace(`:${PICTURE_PARAMS.kind}`, kind)
    .replace(`:${PICTURE_PARAMS.version}`, encodeURIComponent(version))

export type ApiClient = ReturnType<typeof createApiClient>

/**
 * Every call a client makes to the media server. `baseUrl` is '' for a web
 * app served by the server itself, or the server's origin for anything
 * running elsewhere (a native app, the Vite dev server behind a proxy).
 * `pictureCdn` is the path of an image CDN on the page's own site, such as
 * Netlify's `/.netlify/images`: capability pictures then go through it, which
 * resizes them to the width asked and re-encodes them as AVIF or WebP at the
 * edge, and keeps each one there for the next viewer.
 */
export const createApiClient = ({
  baseUrl = '',
  fetch,
  accessToken = () => null,
  pictureCdn = null,
}: {
  baseUrl?: string
  fetch: FetchLike
  accessToken?: () => string | null
  pictureCdn?: string | null
}) => {
  const root = baseUrl.replace(/\/+$/, '')
  const url = (path: string): string => `${root}${path}`

  /**
   * A capability picture at `path`, narrowed to `width` when one is given:
   * through the image CDN when there is one, else straight from the server,
   * which keeps a poster at the fixed few `POSTER_WIDTHS`.
   */
  const pictureAt = ({ path, width }: { path: string; width?: number }): string => {
    if (pictureCdn !== null) {
      const query: Record<string, string> =
        width === undefined ? { url: url(path) } : { url: url(path), w: String(width) }
      return `${pictureCdn}?${toQueryString(query)}`
    }
    return width === undefined ? url(path) : `${url(path)}?${toQueryString({ w: String(width) })}`
  }

  /** `widths` as an `img`'s `srcset` of `path`, the widest, the picture's own, asked with no width. */
  const pictureSrcSet = ({
    path,
    widths,
    own,
  }: {
    path: string
    widths: readonly number[]
    own: number
  }): string =>
    widths
      .map((width) => `${pictureAt(width === own ? { path } : { path, width })} ${width}w`)
      .join(', ')

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
    const queryString = toQueryString(
      access === null ? query : { ...query, [MEDIA_TICKET_PARAM]: access.ticket },
    )
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
    // Absolute media URLs are a separate trust boundary, even when their origin
    // happens to match the server. Only the generated API URL receives credentials.
    const token = href === url(path) && path.startsWith(AUTH_API_PREFIX) ? accessToken() : null
    const response = await fetch(href, {
      method,
      headers: {
        ...(body === undefined ? { accept } : { accept, 'content-type': 'application/json' }),
        ...(token === null ? {} : { [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const responseBody = await readJson(response)
      throw new ApiError({
        status: response.status,
        message: errorMessage({
          body: responseBody,
          fallback: response.statusText || 'Request failed',
        }),
        refusal: isAuthRefusal(responseBody) ? responseBody : null,
        isServerUnreachable: isUnreachableAnswer({ status: response.status, body: responseBody }),
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

  const itemImageAt = (picture: Parameters<typeof itemPicturePath>[0]): string =>
    pictureAt({ path: itemPicturePath(picture) })

  const posterWidths: readonly number[] = pictureCdn === null ? POSTER_WIDTHS : CDN_POSTER_WIDTHS

  return {
    getAuthConfig: (): Promise<AuthConfig> =>
      expect({ request: send({ path: AUTH_PATHS.config }), guard: isAuthConfig }),

    getMe: (): Promise<Account> =>
      expect({ request: send({ path: AUTH_PATHS.me }), guard: isAccount }),

    listMembers: ({
      pageSize = 100,
      pageOffset = 0,
    }: { pageSize?: number; pageOffset?: number } = {}): Promise<Account[]> =>
      expect({
        request: send({
          path: `${AUTH_PATHS.members}?${toQueryString({ [AUTH_PARAMS.pageSize]: String(pageSize), [AUTH_PARAMS.pageOffset]: String(pageOffset) })}`,
        }),
        guard: isAccountList,
      }),

    setMemberStatus: ({
      id,
      change,
    }: {
      id: string
      change: MemberStatusChange
    }): Promise<Account> =>
      expect({
        request: send({
          path: AUTH_PATHS.memberStatus.replace(`:${AUTH_PARAMS.id}`, encodeURIComponent(id)),
          method: AUTH_METHODS.post,
          body: change,
        }),
        guard: isAccount,
      }),

    getAccountTicket: ({ id }: { id: number }): Promise<MediaTicket> =>
      expect({
        request: send({
          path: AUTH_PATHS.ticket.replace(`:${AUTH_PARAMS.id}`, String(id)),
          method: AUTH_METHODS.post,
        }),
        guard: isMediaTicket,
      }),

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

    /**
     * Refresh: a quick scan for new files, and every movie's and show's
     * ratings fetched again. Pressed while one runs, it only scans.
     */
    refreshLibrary: (id: number): Promise<Library> =>
      expect({
        request: send({ path: `/api/libraries/${id}/refresh`, method: 'POST' }),
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

    /** Where playback got to, and the audio track playing, for the admin's Streams page. */
    saveProgress: async ({
      id,
      position,
      audio,
    }: { id: number } & ProgressReport): Promise<void> => {
      await send({
        path: `/api/media/${id}/progress`,
        method: 'PUT',
        body: { position, audio } satisfies ProgressReport,
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

    /** Marks a show or season a favourite, or not, and answers with its page. */
    setItemFavourite: ({
      id,
      favourite,
    }: {
      id: number
      favourite: boolean
    }): Promise<ItemDetails> =>
      expect({
        request: send({
          path: `/api/items/${id}/favourite`,
          method: 'PUT',
          body: { favourite } satisfies FavouriteChange,
        }),
        guard: isItemDetails,
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

    /** Every show and season marked a favourite, most recently marked first. */
    listFavouriteTitles: (): Promise<ItemSummary[]> =>
      expect({ request: send({ path: '/api/favourites/titles' }), guard: isFavouriteTitles }),

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
      media.thumbnail === THUMBNAIL_STATES.ready
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

    /**
     * Episodes of a show or a season in a random order, the first to play
     * first, from whichever libraries hold them; empty with none to play.
     */
    shuffleEpisodes: (itemId: number): Promise<MediaItem[]> =>
      expect({
        request: send({ path: `/api/items/${itemId}/shuffle` }),
        guard: isMediaList,
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
    posterSrcSet: ({ id, version }: { id: number; version: string | null }): string | null =>
      version == null
        ? null
        : pictureSrcSet({
            path: itemPicturePath({ id, kind: ITEM_IMAGE_KINDS.poster, version }),
            widths: posterWidths,
            own: POSTER_OWN_WIDTH,
          }),

    /** The widths `posterSrcSet` lists, narrowest first: finer through an image CDN. */
    posterWidths,

    /**
     * An item's backdrop at each width an image CDN makes of it, for an
     * `img`'s `srcset` beside `itemImageUrl`'s; null with no CDN, where the
     * server keeps a backdrop at its own width alone, or with no backdrop.
     */
    backdropSrcSet: ({ id, version }: { id: number; version: string | null }): string | null =>
      version == null || pictureCdn === null
        ? null
        : pictureSrcSet({
            path: itemPicturePath({ id, kind: ITEM_IMAGE_KINDS.backdrop, version }),
            widths: CDN_BACKDROP_WIDTHS,
            own: BACKDROP_OWN_WIDTH,
          }),

    /** One of a saga's movies' backdrops; versioned, so cached for good. */
    sagaPictureUrl: (picture: SagaPicture): string =>
      itemImageAt({ id: picture.id, kind: ITEM_IMAGE_KINDS.backdrop, version: picture.version }),

    /** The picture behind a library's row on the Libraries page; versioned, so cached for good. */
    libraryBackdropUrl: (backdrop: LibraryBackdrop): string => {
      switch (backdrop.type) {
        case LIBRARY_BACKDROP_TYPES.item:
          return itemImageAt({
            id: backdrop.id,
            kind: ITEM_IMAGE_KINDS.backdrop,
            version: backdrop.version,
          })
        case LIBRARY_BACKDROP_TYPES.thumbnail:
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
        : pictureAt({
            path: PICTURE_PATHS.photo
              .replace(`:${PICTURE_PARAMS.id}`, String(personId))
              .replace(`:${PICTURE_PARAMS.version}`, encodeURIComponent(photoVersion)),
          }),

    /** A Fix match result's poster, through the server's image cache. */
    candidatePosterUrl: (poster: string | null): string | null =>
      poster == null ? null : url(`/api/images/poster${poster}`),

    /**
     * A TMDB poster path at each width the server keeps, for an `img`'s `src`
     * and `srcset`; `src` is the middle width, for a browser with no `srcset`.
     * The widest is the URL with no width, as in `posterSrcSet`, so it is the
     * one `candidatePosterUrl` asks for and the browser keeps one copy.
     */
    tmdbPosterSources: (poster: string): { src: string; srcSet: string } => {
      const own = url(`/api/images/poster${poster}`)
      const at = (width: PosterWidth): string =>
        width === POSTER_OWN_WIDTH ? own : `${own}?${toQueryString({ w: String(width) })}`
      return {
        src: at(POSTER_WIDTHS[1]),
        srcSet: POSTER_WIDTHS.map((width) => `${at(width)} ${width}w`).join(', '),
      }
    },

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
      option.source === IMAGE_SOURCES.local
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
    /** What the server is sending to whom right now. Admin only. */
    listLiveStreams: (): Promise<LiveStream[]> =>
      expect({ request: send({ path: '/api/streams' }), guard: isLiveStreamList }),

    /** Ends one stream's connections; the player may ask again. Admin only. */
    stopStream: async (id: string): Promise<void> => {
      await send({ path: `/api/streams/${encodeURIComponent(id)}/stop`, method: 'POST' })
    },

    /** Sends what the player gathered about a video that would not play, for the admin to read later. */
    reportPlaybackError: (diagnostics: PlaybackDiagnostics): Promise<BugReport> =>
      expect({
        request: send({ path: BUG_REPORT_PATHS.reports, method: 'POST', body: diagnostics }),
        guard: isBugReport,
      }),

    /** Every bug report, newest first. Admin only. */
    listBugReports: (): Promise<BugReport[]> =>
      expect({ request: send({ path: BUG_REPORT_PATHS.reports }), guard: isBugReportList }),

    /** Moves a report on, as the admin works through it. Admin only. */
    setBugReportStatus: ({
      id,
      status,
    }: {
      id: number
      status: BugReportStatus
    }): Promise<BugReport> =>
      expect({
        request: send({
          path: BUG_REPORT_PATHS.status.replace(`:${BUG_REPORT_PARAMS.id}`, String(id)),
          method: 'PUT',
          body: { status } satisfies BugReportStatusChange,
        }),
        guard: isBugReport,
      }),

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
     * The HLS master playlist for a converted stream. It mints a session
     * that holds `mode`, `audio` and `quality`, which are read as for
     * `streamUrl`.
     */
    hlsUrl: ({
      id,
      mode,
      audio,
      quality,
      access,
    }: {
      id: number
      mode: StreamMode
      audio: number | null
      quality: StreamQuality | null
      access: MediaAccess | null
    }): string =>
      mediaUrl({
        path: HLS_PATHS.master.replace(`:${HLS_PARAMS.id}`, String(id)),
        query: {
          [HLS_PARAMS.mode]: mode,
          ...(audio == null ? {} : { [HLS_PARAMS.audio]: String(audio) }),
          ...(quality == null ? {} : { [HLS_PARAMS.quality]: quality }),
        },
        access,
      }),

    /**
     * A converted stream as fragmented MP4, starting at `start` seconds into
     * the file and stamped with file time plus `STREAM_TIME_SHIFT`. `audio`
     * picks the track by its `0:a:N` index; left out, the default plays.
     * `quality` sizes a transcode; left out, the server's settings do.
     */
    streamUrl: ({
      id,
      mode,
      start,
      audio,
      quality = null,
      access = null,
    }: {
      id: number
      mode: StreamMode
      start: number
      audio: number | null
      quality?: StreamQuality | null
      access?: MediaAccess | null
    }): string =>
      mediaUrl({
        path: `/api/media/${id}/stream`,
        query: {
          mode,
          start: String(Math.max(0, Math.round(start * 1000) / 1000)),
          ...(audio == null ? {} : { audio: String(audio) }),
          ...(quality == null ? {} : { quality }),
        },
        access,
      }),
  }
}
