import { Inject, Injectable } from '@nestjs/common'
import {
  ITEM_TYPES,
  type Infer,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  listOf,
  type MatchItemType,
  nullable,
  object,
  optional,
  toQueryString,
} from '@raven/core'
import {
  CONTENT_TYPES,
  HEADERS,
  HTTP_METHODS,
  HTTP_STATUSES,
  type HttpMethod,
} from '@shared/server'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { METADATA_FETCH, type MetadataFetch } from '@/metadata/tmdbClient'
import type { ArrServer } from '@/requests/requestsConfig'

/** How long raven waits on Sonarr or Radarr before it gives up on a call. */
const ARR_TIMEOUT_MS = 15_000

/** The header both arrs read their API key from. */
const API_KEY_HEADER = 'X-Api-Key'

const API = '/api/v3'

/** The search commands each arr runs for one title, by the names its API takes. */
const SEARCH_COMMANDS = {
  [ITEM_TYPES.movie]: 'MoviesSearch',
  [ITEM_TYPES.show]: 'SeriesSearch',
} as const satisfies Record<MatchItemType, string>

/** Where each arr keeps its titles: `/api/v3/movie` and `/api/v3/series`. */
const TITLE_ROUTES = {
  [ITEM_TYPES.movie]: `${API}/movie`,
  [ITEM_TYPES.show]: `${API}/series`,
} as const satisfies Record<MatchItemType, string>

/** The query `queue/details` filters one title's downloads by. */
const QUEUE_FILTERS = {
  [ITEM_TYPES.movie]: 'movieId',
  [ITEM_TYPES.show]: 'seriesId',
} as const satisfies Record<MatchItemType, string>

/** How far ahead of a day Radarr's calendar is read for the movies still to come: ten years. */
const CALENDAR_REACH_MS = 10 * 365 * 24 * 60 * 60 * 1000

/** The values the arrs' add calls take: monitor every season, and wait for a movie's release. */
const ADD_VALUES = { released: 'released', allSeasons: 'all' } as const

/** A command's states while it has yet to finish, as both arrs name them. */
const RUNNING_COMMAND_STATES: ReadonlySet<string> = new Set(['queued', 'started'])

/** Why a call to an arr failed: not set up, unreachable, or an answer raven could not read. */
export const ARR_ERROR_KINDS = {
  off: 'off',
  failed: 'failed',
} as const

type ArrErrorKind = (typeof ARR_ERROR_KINDS)[keyof typeof ARR_ERROR_KINDS]

type ArrErrorProps = { kind: ArrErrorKind; message: string }

/** A Sonarr or Radarr call that failed. Its message never holds the arr's key. */
export class ArrError extends Error {
  readonly kind: ArrErrorKind

  constructor({ kind, message }: ArrErrorProps) {
    super(message)
    this.name = 'ArrError'
    this.kind = kind
  }
}

const isRootFolder = object({ path: isString })

const isQuality = object({ quality: object({ resolution: isNumber }) })

/** One row of a profile: a quality, or a group of them, and whether the profile takes it. */
const isProfileItem = object({
  allowed: isBoolean,
  quality: optional(object({ resolution: isNumber })),
  items: optional(listOf(isQuality)),
})

const isQualityProfile = object({ id: isNumber, name: isString, items: listOf(isProfileItem) })

type ProfileItem = Infer<typeof isProfileItem>

/** The resolutions a profile row lets the arr download: none unless it is allowed. */
const resolutionsOf = (item: ProfileItem): number[] => {
  if (!item.allowed) return []
  const grouped = (item.items ?? []).map((member) => member.quality.resolution)
  return item.quality === undefined ? grouped : [item.quality.resolution, ...grouped]
}

/** An arr's answer once it has a title or a command: its id. */
const isIdentified = object({ id: isNumber })

const isCommand = object({ status: isString })

/** One download in the arr's queue: whose it is, how far the client is, and what the arr is doing with it. */
const isQueueEntry = object({
  movieId: optional(nullable(isNumber)),
  seriesId: optional(nullable(isNumber)),
  status: optional(isString),
  trackedDownloadState: optional(isString),
})

export type QueueEntry = Infer<typeof isQueueEntry>

const isMovie = object({ hasFile: optional(isBoolean) })

const isSeries = object({
  statistics: optional(object({ episodeFileCount: optional(isNumber) })),
})

/** A title in an arr's library: its ids, when it was added, and each day the arr knows it comes out on. */
const isHeldTitle = object({
  id: isNumber,
  title: isString,
  added: isString,
  tmdbId: optional(nullable(isNumber)),
  firstAired: optional(nullable(isString)),
  inCinemas: optional(nullable(isString)),
  digitalRelease: optional(nullable(isString)),
  physicalRelease: optional(nullable(isString)),
})

type HeldTitle = Infer<typeof isHeldTitle>

/** The first day a held title comes out on, `YYYY-MM-DD`: a show's first episode, or the earliest of a movie's releases. */
const releasedOf = (held: HeldTitle): string | null =>
  [held.firstAired, held.inCinemas, held.digitalRelease, held.physicalRelease]
    .flatMap((day) => (day == null || day === '' ? [] : [day.slice(0, 10)]))
    .toSorted()[0] ?? null

/** A lookup's answer: the arr's own record of the title, sent back whole to add it. */
const isLookedUp = object({
  title: isString,
  id: optional(nullable(isNumber)),
})

/** An arr's id, or null for the none (absent, null or 0) a lookup answers for a title it does not hold. */
const idOf = (id: number | null | undefined): number | null =>
  id !== null && id !== undefined && id > 0 ? id : null

/** A title as the arr's lookup found it: its record to add, and its id when the arr already holds it. */
export type ArrTitle = {
  title: string
  existingId: number | null
  record: Record<string, unknown>
}

/** A quality profile: its id, and every resolution it lets the arr download. */
export type ArrQualityProfile = { id: number; resolutions: number[] }

/** What the arr holds of a title now: its downloads in the queue and whether it has a file. */
export type ArrProgress = {
  queue: QueueEntry[]
  hasFile: boolean
}

type CallProps = {
  type: MatchItemType
  path: string
  method?: HttpMethod
  body?: unknown
}

type LookUpProps = { type: MatchItemType; tmdbId: string }

type AddProps = {
  type: MatchItemType
  title: ArrTitle
  rootFolder: string
  qualityProfileId: number
}

/** A title an arr holds that is still to come: when the arr took it on, and how far its download is. */
export type ArrHolding = {
  arrId: number
  tmdbId: string
  title: string
  /** When it was added to the arr, as an ISO time. */
  addedAt: string
  progress: ArrProgress
}

type HoldingsProps = {
  type: MatchItemType
  /** `YYYY-MM-DD`, the earliest day out a title still to come has. */
  from: string
}

type ByTitleProps = { type: MatchItemType; arrId: number }

type CommandProps = { type: MatchItemType; commandId: number }

type QualityProfileProps = { type: MatchItemType; name: string }

/**
 * Sonarr for shows and Radarr for movies, over their v3 API. Every answer is
 * checked before it is used, and no address or key ever leaves the server.
 */
@Injectable()
export class ArrClient {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(METADATA_FETCH) private readonly fetch: MetadataFetch,
  ) {}

  /** Whether requests of `type` can go anywhere. */
  isOn(type: MatchItemType): boolean {
    return this.config.requests.arrs[type] !== null
  }

  private serverOf(type: MatchItemType): ArrServer {
    const server = this.config.requests.arrs[type]
    if (server === null) {
      throw new ArrError({ kind: ARR_ERROR_KINDS.off, message: `Requests for a ${type} are off` })
    }
    return server
  }

  /** The answer's JSON, or null for a 404; anything else that is not a success throws. */
  private async call({ type, path, method, body }: CallProps): Promise<unknown> {
    const server = this.serverOf(type)
    const response = await this.fetch({
      url: `${server.url}${path}`,
      init: {
        headers: {
          [API_KEY_HEADER]: server.apiKey,
          [HEADERS.contentType]: CONTENT_TYPES.json,
          [HEADERS.accept]: CONTENT_TYPES.json,
        },
        signal: AbortSignal.timeout(ARR_TIMEOUT_MS),
        ...(method === undefined ? {} : { method }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    }).catch((error: unknown) => {
      throw new ArrError({
        kind: ARR_ERROR_KINDS.failed,
        message: `Could not reach the ${type} downloader: ${errorMessage(error)}`,
      })
    })
    // A 404 is a record that is not there: a command the arr has since forgotten.
    if (response.status === HTTP_STATUSES.notFound) return null
    if (!response.ok) {
      throw new ArrError({
        kind: ARR_ERROR_KINDS.failed,
        message: `The ${type} downloader answered ${response.status} to ${method ?? HTTP_METHODS.get} ${path.split('?')[0] ?? path}`,
      })
    }
    return response.json().catch(() => {
      throw new ArrError({
        kind: ARR_ERROR_KINDS.failed,
        message: `The ${type} downloader's answer to ${path.split('?')[0] ?? path} was not JSON`,
      })
    })
  }

  private unreadable(what: string): ArrError {
    return new ArrError({ kind: ARR_ERROR_KINDS.failed, message: `Could not read ${what}` })
  }

  /** The arr's record of a TMDB title, and its id when the arr holds it already; null when it knows none. */
  async lookUp({ type, tmdbId }: LookUpProps): Promise<ArrTitle | null> {
    const path =
      type === ITEM_TYPES.movie
        ? `${API}/movie/lookup/tmdb?${toQueryString({ tmdbId })}`
        : `${API}/series/lookup?${toQueryString({ term: `tmdb:${tmdbId}` })}`
    const [answer, heldId] = await Promise.all([
      this.call({ type, path }),
      type === ITEM_TYPES.movie ? this.heldMovieId(tmdbId) : Promise.resolve(null),
    ])
    const found = Array.isArray(answer) ? answer[0] : answer
    if (found === null || found === undefined) return null
    if (!isLookedUp(found) || !isRecord(found)) throw this.unreadable(`the ${type} lookup`)
    return { title: found.title, existingId: heldId ?? idOf(found.id), record: found }
  }

  /**
   * The arr's id for a TMDB title it holds, or null. Radarr's TMDB lookup
   * answers fresh metadata with no id even for a movie it holds, so a movie
   * is found in its library instead; Sonarr's lookup carries the id.
   */
  async heldId({ type, tmdbId }: LookUpProps): Promise<number | null> {
    if (type === ITEM_TYPES.movie) return this.heldMovieId(tmdbId)
    const found = await this.lookUp({ type, tmdbId })
    return found?.existingId ?? null
  }

  private async heldMovieId(tmdbId: string): Promise<number | null> {
    const type = ITEM_TYPES.movie
    const answer = await this.call({ type, path: `${API}/movie?${toQueryString({ tmdbId })}` })
    if (answer === null) return null
    if (!listOf(isIdentified)(answer)) throw this.unreadable('the movie library')
    return idOf(answer[0]?.id)
  }

  /** The arr's root folders' paths. */
  async rootFolders(type: MatchItemType): Promise<string[]> {
    const answer = await this.call({ type, path: `${API}/rootfolder` })
    if (!listOf(isRootFolder)(answer)) throw this.unreadable('the root folders')
    return answer.map((folder) => folder.path.replace(/\/+$/u, ''))
  }

  /** The quality profile called `name`, or null when the arr has none by that name. */
  async qualityProfile({ type, name }: QualityProfileProps): Promise<ArrQualityProfile | null> {
    const answer = await this.call({ type, path: `${API}/qualityprofile` })
    if (!listOf(isQualityProfile)(answer)) throw this.unreadable('the quality profiles')
    const profile = answer.find((each) => each.name === name)
    if (profile === undefined) return null
    return { id: profile.id, resolutions: profile.items.flatMap(resolutionsOf) }
  }

  /** Adds the title, monitored, under `rootFolder`, where the arr names its folder itself; answers its id. */
  async add({ type, title, rootFolder, qualityProfileId }: AddProps): Promise<number> {
    const kindFields =
      type === ITEM_TYPES.movie
        ? { minimumAvailability: ADD_VALUES.released, addOptions: { searchForMovie: false } }
        : {
            seasonFolder: true,
            addOptions: { monitor: ADD_VALUES.allSeasons, searchForMissingEpisodes: false },
          }
    const answer = await this.call({
      type,
      path: TITLE_ROUTES[type],
      method: HTTP_METHODS.post,
      body: {
        ...title.record,
        qualityProfileId,
        rootFolderPath: rootFolder,
        monitored: true,
        ...kindFields,
      },
    })
    if (!isIdentified(answer)) throw this.unreadable(`the added ${type}`)
    return answer.id
  }

  /** Starts a search for the title; answers the command's id. */
  async search({ type, arrId }: ByTitleProps): Promise<number> {
    const target = type === ITEM_TYPES.movie ? { movieIds: [arrId] } : { seriesId: arrId }
    const answer = await this.call({
      type,
      path: `${API}/command`,
      method: HTTP_METHODS.post,
      body: { name: SEARCH_COMMANDS[type], ...target },
    })
    if (!isIdentified(answer)) throw this.unreadable('the search command')
    return answer.id
  }

  /** Whether the search command is still queued or running; a command the arr forgot has finished. */
  async isCommandRunning({ type, commandId }: CommandProps): Promise<boolean> {
    const answer = await this.call({ type, path: `${API}/command/${commandId}` })
    if (answer === null) return false
    if (!isCommand(answer)) throw this.unreadable('the search command')
    return RUNNING_COMMAND_STATES.has(answer.status)
  }

  /**
   * Every title the arr holds that first comes out on `from` or later, with
   * its downloads in the queue and whether it has a file. Radarr's whole
   * library is tens of megabytes, so its movies are read from its calendar,
   * which lists the ones with a release from `from` on; Sonarr has no such
   * list of series, so every series is read.
   */
  async holdings({ type, from }: HoldingsProps): Promise<ArrHolding[]> {
    const until = new Date(Date.parse(from) + CALENDAR_REACH_MS).toISOString().slice(0, 10)
    const path =
      type === ITEM_TYPES.movie
        ? `${API}/calendar?${toQueryString({ start: from, end: until, unmonitored: 'true' })}`
        : TITLE_ROUTES[type]
    const [titles, queue] = await Promise.all([
      this.call({ type, path }),
      this.call({ type, path: `${API}/queue/details` }),
    ])
    if (!listOf(isHeldTitle)(titles)) throw this.unreadable(`the ${type} library`)
    if (!listOf(isQueueEntry)(queue)) throw this.unreadable('the download queue')
    return titles.flatMap((held) => {
      const tmdbId = idOf(held.tmdbId)
      const released = releasedOf(held)
      if (tmdbId === null || released === null || released < from) return []
      return [
        {
          arrId: held.id,
          tmdbId: String(tmdbId),
          title: held.title,
          addedAt: held.added,
          progress: {
            queue: queue.filter((entry) => entry[QUEUE_FILTERS[type]] === held.id),
            hasFile: hasFileOf({ type, held }),
          },
        },
      ]
    })
  }

  /** The title's downloads in the queue, and whether the arr holds a file of it. */
  async progress({ type, arrId }: ByTitleProps): Promise<ArrProgress> {
    const [queue, held] = await Promise.all([
      this.call({
        type,
        path: `${API}/queue/details?${toQueryString({ [QUEUE_FILTERS[type]]: String(arrId) })}`,
      }),
      this.call({ type, path: `${TITLE_ROUTES[type]}/${arrId}` }),
    ])
    if (!listOf(isQueueEntry)(queue)) throw this.unreadable('the download queue')
    return { queue, hasFile: hasFileOf({ type, held }) }
  }
}

type HasFileOfProps = { type: MatchItemType; held: unknown }

/** Radarr's `hasFile`, or Sonarr's count of episode files over none. */
const hasFileOf = ({ type, held }: HasFileOfProps): boolean => {
  if (type === ITEM_TYPES.movie) return isMovie(held) && !!held.hasFile
  return isSeries(held) && (held.statistics?.episodeFileCount ?? 0) > 0
}
