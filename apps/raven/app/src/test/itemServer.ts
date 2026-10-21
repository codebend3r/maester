import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type ApiClient,
  CREDIT_JOBS,
  type EpisodeSummary,
  ITEM_TYPES,
  type ItemDetails,
  type ItemSummary,
  MATCH_STATES,
  type MediaTracks,
  type SeasonSummary,
  createApiClient,
  isRecord,
} from '@raven/core'

import { allowlistedFetch } from '@/servers/allowlist'
import {
  type Answer,
  type HeardRequest,
  NOT_FOUND,
  STATUSES,
  pathFor,
  responseOf,
} from '@/test/fixtureFetch'
import { FILMS, NAS, SERIES } from '@/test/homeServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

const detailsFor = ({
  summary,
  overrides,
}: {
  summary: ItemSummary
  overrides: Partial<ItemDetails>
}): ItemDetails => ({
  ...summary,
  tmdbId: String(summary.id),
  imdbId: null,
  originalTitle: null,
  tagline: null,
  summary: null,
  contentRating: null,
  released: null,
  ended: null,
  runtime: null,
  studio: null,
  genres: [],
  logoVersion: null,
  favourite: null,
  aiMatch: null,
  credits: [],
  reviews: [],
  versions: [],
  children: [],
  ...overrides,
})

const BUSBOYS_SUMMARY = summaryFor({ id: 40, title: 'Busboys' })

/** A movie stopped halfway: 50 minutes in, 50 left. */
export const BUSBOYS_FILE = mediaItemFor({
  id: 20,
  libraryId: FILMS.id,
  title: 'Busboys',
  fileName: 'Busboys (2026).mkv',
  duration: 6000,
  position: 3000,
  match: MATCH_STATES.matched,
  item: BUSBOYS_SUMMARY,
})

export const BUSBOYS = detailsFor({
  summary: BUSBOYS_SUMMARY,
  overrides: {
    tagline: 'Every table has a story.',
    summary: 'Two busboys at a downtown steakhouse plan one last perfect shift.',
    contentRating: 'R',
    genres: ['Comedy', 'Drama'],
    credits: [
      {
        personId: 1,
        name: 'Mark Kimball',
        job: CREDIT_JOBS.cast,
        role: 'Rudy',
        photoVersion: 'k1',
      },
      { personId: 2, name: 'Ana Ortiz', job: CREDIT_JOBS.cast, role: 'Lena', photoVersion: null },
      {
        personId: 1,
        name: 'Mark Kimball',
        job: CREDIT_JOBS.director,
        role: 'Director',
        photoVersion: 'k1',
      },
    ],
    versions: [BUSBOYS_FILE],
  },
})

const SEVERANCE_SUMMARY = summaryFor({
  id: 4,
  type: ITEM_TYPES.show,
  title: 'Severance',
  year: 2022,
})
const SHOW = { id: SEVERANCE_SUMMARY.id, title: SEVERANCE_SUMMARY.title }

const seasonFor = ({ id, season }: { id: number; season: number }): SeasonSummary => ({
  ...summaryFor({
    id,
    type: ITEM_TYPES.season,
    title: `Season ${season}`,
    year: 2022,
    show: SHOW,
    season,
    backdropVersion: null,
  }),
  type: ITEM_TYPES.season,
  episodeCount: 2,
  watchedCount: 0,
})

const episodeFor = ({
  id,
  episode,
  title,
  fileId,
}: {
  id: number
  episode: number
  title: string
  fileId: number
}): EpisodeSummary => {
  const summary = summaryFor({
    id,
    type: ITEM_TYPES.episode,
    title,
    year: 2022,
    show: SHOW,
    season: 1,
    episode,
    posterVersion: null,
    backdropVersion: null,
  })
  return {
    ...summary,
    type: ITEM_TYPES.episode,
    summary: null,
    released: '2022-02-18',
    runtime: 55,
    stillVersion: `s${id}`,
    watched: false,
    primary: mediaItemFor({
      id: fileId,
      libraryId: SERIES.id,
      title,
      fileName: `Severance - S01E0${episode} - ${title}.mkv`,
      duration: 3300,
      match: MATCH_STATES.matched,
      item: summary,
    }),
  }
}

const SEASON_ONE = seasonFor({ id: 5, season: 1 })
const SEASON_TWO = seasonFor({ id: 7, season: 2 })
const GOOD_NEWS = episodeFor({ id: 6, episode: 1, title: 'Good News About Hell', fileId: 12 })
const HALF_LOOP = episodeFor({ id: 8, episode: 2, title: 'Half Loop', fileId: 13 })

export const SEVERANCE = detailsFor({
  summary: SEVERANCE_SUMMARY,
  overrides: {
    summary: 'Mark leads a team of office workers whose memories have been split.',
    studio: 'Apple TV+',
    favourite: false,
    children: [SEASON_ONE, SEASON_TWO],
  },
})

export const SEVERANCE_ONE = detailsFor({
  summary: SEASON_ONE,
  overrides: { children: [GOOD_NEWS, HALF_LOOP] },
})

export const GOOD_NEWS_ABOUT_HELL = detailsFor({
  summary: GOOD_NEWS,
  overrides: {
    summary: 'Mark is promoted.',
    released: GOOD_NEWS.released,
    runtime: GOOD_NEWS.runtime,
    backdropVersion: GOOD_NEWS.stillVersion,
    versions: GOOD_NEWS.primary === null ? [] : [GOOD_NEWS.primary],
  },
})

const TRACKS: MediaTracks = { audio: [], subtitles: [], defaultAudio: null, frameRate: null }

const {
  getItem,
  listLibraries,
  nextEpisode,
  getTracks,
  setWatched,
  setFavourite,
  setItemFavourite,
} = APP_CLIENT_CALLS

const READS: Record<string, unknown> = {
  [listLibraries.path]: [FILMS, SERIES],
  [pathFor({ path: getItem.path, id: BUSBOYS.id })]: BUSBOYS,
  [pathFor({ path: getItem.path, id: SEVERANCE.id })]: SEVERANCE,
  [pathFor({ path: getItem.path, id: SEVERANCE_ONE.id })]: SEVERANCE_ONE,
  [pathFor({ path: getItem.path, id: GOOD_NEWS_ABOUT_HELL.id })]: GOOD_NEWS_ABOUT_HELL,
  [pathFor({ path: nextEpisode.path, id: SEVERANCE.id })]: GOOD_NEWS.primary,
  [pathFor({ path: getTracks.path, id: BUSBOYS_FILE.id })]: TRACKS,
  [pathFor({ path: getTracks.path, id: 12 })]: TRACKS,
}

/** Whether a favourite change asks for a favourite. */
const isMarked = (body: unknown): boolean => isRecord(body) && body.favourite === true

/** The answer of a write that sends nothing back, as `PUT /api/watched` does. */
const NO_CONTENT: Answer = { status: STATUSES.noContent, body: null }

const WRITES: Record<string, (body: unknown) => Answer> = {
  [setWatched.path]: () => NO_CONTENT,
  [pathFor({ path: setFavourite.path, id: BUSBOYS_FILE.id })]: (body) => ({
    status: STATUSES.ok,
    body: { ...BUSBOYS_FILE, favourite: isMarked(body) },
  }),
  [pathFor({ path: setItemFavourite.path, id: SEVERANCE.id })]: (body) => ({
    status: STATUSES.ok,
    body: { ...SEVERANCE, favourite: isMarked(body) },
  }),
}

/** What the server answers `method` at `path` with, sent `body`. */
const answerFor = ({
  method,
  path,
  body,
}: {
  method: string
  path: string
  body: unknown
}): Answer => {
  if (method !== APP_CALL_METHODS.get) return WRITES[path]?.(body) ?? NOT_FOUND
  const read = READS[path]
  return read === undefined ? NOT_FOUND : { status: STATUSES.ok, body: read }
}

const bodyOf = (body: string | undefined): unknown => (body === undefined ? null : JSON.parse(body))

/**
 * Busboys, Severance, its first season and that season's first episode, behind the app's
 * allowlist so an unlisted call fails the test. Every write is heard, and answered once
 * `writes` lets it through, and every read once `reads` lets its path through, so a test can
 * look at the screen while the server is still busy.
 */
export const itemApi = ({
  hear = () => undefined,
  writes = async () => undefined,
  reads = async () => undefined,
}: {
  hear?: (request: HeardRequest) => void
  writes?: () => Promise<void>
  reads?: (path: string) => Promise<void>
} = {}): ApiClient =>
  createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      hasAccounts: () => false,
      fetch: async (url, init = {}) => {
        const path = url.slice(NAS.origin.length)
        const method = init.method ?? APP_CALL_METHODS.get
        const sent = bodyOf(init.body)
        hear({ method, path, body: sent })
        await (method === APP_CALL_METHODS.get ? reads(path) : writes())
        return responseOf(answerFor({ method, path, body: sent }))
      },
    }),
  })
