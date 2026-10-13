import type { Anthropic } from '@anthropic-ai/sdk'
import {
  isMatchItemType,
  isNumber,
  isString,
  isTmdbId,
  type LibraryKind,
  type MatchItemType,
  nullable,
  object,
  type PathLayout,
} from '@raven/core'
import { isAiConfidence } from '@/metadata/aiDecisions'
import type { SearchResult } from '@/metadata/tmdbClient'

/**
 * What the AI lookup is told of a group left unmatched: never a path
 * outside the library.
 */
export type AiGroup = {
  kind: LibraryKind
  type: MatchItemType
  /** How the path the files sit in was read; null before its first full scan. */
  layout: PathLayout | null
  /** The group's place inside the folder its titles sit in: `Doctor Who (2023)`, or a loose file's name. */
  place: string
  fileCount: number
  /** Some of its files, each as its path inside the place, spread over the group. */
  fileNames: string[]
  /** The show (for a movie, its title) and year raven read from the names. */
  parsed: { title: string; year: number | null }
  /** The searches matching ran, which found nothing it was sure of. */
  tried: Array<{ title: string; year: number | null }>
}

export const AI_TOOL_NAMES = {
  search: 'search_tmdb',
  episodes: 'list_episodes',
  choose: 'choose_match',
} as const

/** How many results one search hands Claude. */
export const AI_SEARCH_RESULTS = 10

/** How much of a result's overview Claude reads, in characters. */
const OVERVIEW_LENGTH = 200

/** The years a search may keep to, the seasons a show may list, and the longest title searched. */
export const AI_INPUT_BOUNDS = {
  years: { min: 1870, max: 2100 },
  seasons: { min: 0, max: 999 },
  queryLength: 200,
} as const

/** A whole number from `min` to `max`: a year, a season. */
const wholeWithin =
  ({ min, max }: { min: number; max: number }) =>
  (value: unknown): value is number =>
    isNumber(value) && Number.isInteger(value) && value >= min && value <= max

/** Words, not only spaces. */
const isText = (value: unknown): value is string => isString(value) && value.trim() !== ''

/**
 * What `search_tmdb` takes; strict tool use guarantees the shape, and this
 * checks it anyway, with bounds the schema cannot hold, so an odd call is
 * answered as an error rather than sent to TMDB.
 */
export const isSearchInput = object({
  type: isMatchItemType,
  query: (value: unknown): value is string =>
    isText(value) && value.length <= AI_INPUT_BOUNDS.queryLength,
  year: nullable(wholeWithin(AI_INPUT_BOUNDS.years)),
})

export const isEpisodesInput = object({
  tmdbId: isTmdbId,
  season: wholeWithin(AI_INPUT_BOUNDS.seasons),
})

export const isChooseInput = object({
  tmdbId: nullable(isTmdbId),
  confidence: isAiConfidence,
  reason: isText,
})

/**
 * The lookup's instructions. They never change, so every lookup reads them
 * and the tools from the prompt cache; anything about one group goes in its
 * first message instead.
 */
export const AI_SYSTEM_PROMPT = `You find which TMDB movie or show a group of video files in someone's home media library is. raven, the media server, matched the library's other files to TMDB by name; it could not match this group with certainty, so it asks you. What you choose with high confidence is applied without review. What you choose with low confidence is shown to the owner as a suggestion to accept or reject. A wrong high answer mislabels their library; a careful low one costs them a click.

You are given, as JSON:
- library: the type of library, and the results it prefers.
- layout: how the library's folders are read.
- place: the group's folder inside the library, or the file's own name when it has no folder.
- files: how many files the group holds, and up to 12 of their paths inside the place, spread across it.
- parsed: the title (for a show, the show's name) and year raven read from the names.
- tried: the searches raven ran, by title and year, which found nothing it was sure of.

How to work:
1. Search with search_tmdb: for movies in a movie library, for shows in a TV library. Try what raven did not: the title without a year, since a folder's year is often wrong or belongs to a remake; the title as the files spell it when the folder is misspelt; an original, shorter or longer title.
2. For a show, call list_episodes on each candidate you are weighing, for a season the files hold, and compare the episode numbers and titles in the file names with TMDB's. That is how you tell apart shows that share a name: a series and its revival, an anime and its live action remake.
3. Call choose_match once, as your last step. You get at most six replies, and one reply may call several tools at once.

Confidence:
- high: the title fits, and for a show the files' episode titles match the candidate's in the season you listed; for a movie, the title and year fit and no other result fits as well. Never answer high for a show you did not check with list_episodes.
- low: a candidate you could not confirm. The episode titles in the names are generic (Episode 1, Part 2) or missing, the files hold a season TMDB does not list, or two results fit equally well.
- No match: choose a tmdbId of null when no result fits, or when the files are really episodes of a different show from the one the folder names. Say which in the reason.

Rules:
- Only choose an id search_tmdb returned in this lookup, of the library's type.
- The reason is one or two plain sentences the owner can check, naming what decided it: "Season 1's episode titles match TMDB's (Polar Night, The Thaw)."
- Nobody answers questions here: decide with what the tools give you.`

/** The three tools, strict, so each call's input fits its schema. */
export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: AI_TOOL_NAMES.search,
    description:
      "Searches TMDB for movies or shows by title, as raven's matcher does, and returns up to 10 results: each one's TMDB id, title, original title, year, genres, original language, countries of origin (shows only) and the start of its overview. A year keeps to results from that year, a show's by its first air date; null searches every year.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...isMatchItemType.values], description: 'movie or show.' },
        query: { type: 'string', description: 'The title to search for.' },
        year: {
          anyOf: [{ type: 'integer' }, { type: 'null' }],
          description: 'The year to keep to, or null for any.',
        },
      },
      required: ['type', 'query', 'year'],
      additionalProperties: false,
    },
  },
  {
    name: AI_TOOL_NAMES.episodes,
    description:
      "Lists a season's episodes as TMDB has them, each with its number and title, for a show search_tmdb returned in this lookup. Compare them with the episode codes and titles in the file names.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tmdbId: { type: 'string', description: "The show's TMDB id, from search_tmdb." },
        season: { type: 'integer', description: 'The season number; 0 is Specials.' },
      },
      required: ['tmdbId', 'season'],
      additionalProperties: false,
    },
  },
  {
    name: AI_TOOL_NAMES.choose,
    description: 'Gives your answer and ends the lookup. Call it once, last.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tmdbId: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description:
            'The TMDB id of the movie or show the files are, from search_tmdb; null when none fits.',
        },
        confidence: {
          type: 'string',
          enum: [...isAiConfidence.values],
          description: 'high when you checked it, low when a person should look at it.',
        },
        reason: {
          type: 'string',
          description: 'One or two plain sentences on what decided it, for the owner to read.',
        },
      },
      required: ['tmdbId', 'confidence', 'reason'],
      additionalProperties: false,
    },
  },
]

/** What each type of library is, as Claude is told. Only types that are matched are ever asked about. */
const LIBRARY_WORDS = {
  movies: 'Movies',
  shows: 'TV shows',
  animeMovies: 'Anime movies: Japanese animation first, then any animation',
  animeShows: 'Anime shows: Japanese animation first, then any animation',
  familyMovies: 'Family movies: family films and animation first',
  familyShows: 'Family TV shows: family shows and animation first',
  documentaries: 'Documentaries: documentaries first, matched as movies',
  sports: 'Sporting events: recorded events such as UFC cards, matched as movies',
  youtube: 'YouTube videos',
  other: 'Other',
} as const satisfies Record<LibraryKind, string>

const LAYOUT_WORDS = {
  flat: 'one folder per title',
  lettered: 'letter folders (A, B, #) that hold the titles',
  grouped: 'group folders (such as Requests) that hold the titles',
  unread: 'not read yet',
} as const satisfies Record<PathLayout | 'unread', string>

/** TMDB's genre names, movies' and shows' together: a search gives only ids. */
const GENRE_NAMES = new Map<number, string>([
  [28, 'Action'],
  [12, 'Adventure'],
  [16, 'Animation'],
  [35, 'Comedy'],
  [80, 'Crime'],
  [99, 'Documentary'],
  [18, 'Drama'],
  [10751, 'Family'],
  [14, 'Fantasy'],
  [36, 'History'],
  [27, 'Horror'],
  [10402, 'Music'],
  [9648, 'Mystery'],
  [10749, 'Romance'],
  [878, 'Science Fiction'],
  [10770, 'TV Movie'],
  [53, 'Thriller'],
  [10752, 'War'],
  [37, 'Western'],
  [10759, 'Action & Adventure'],
  [10762, 'Kids'],
  [10763, 'News'],
  [10764, 'Reality'],
  [10765, 'Sci-Fi & Fantasy'],
  [10766, 'Soap'],
  [10767, 'Talk'],
  [10768, 'War & Politics'],
])

/** One search result as Claude reads it. */
export const describeCandidate = (result: SearchResult) => ({
  tmdbId: result.tmdbId,
  title: result.title,
  originalTitle: result.originalTitle,
  year: result.year,
  genres: result.genreIds.map((id) => GENRE_NAMES.get(id) ?? `genre ${id}`),
  language: result.originalLanguage,
  countries: result.countries,
  overview: result.overview?.slice(0, OVERVIEW_LENGTH) ?? null,
})

/** The facts of a group, as its lookup's first message gives them. */
const factsOf = (group: AiGroup) => ({
  library: LIBRARY_WORDS[group.kind],
  layout: LAYOUT_WORDS[group.layout ?? 'unread'],
  place: group.place,
  files: { count: group.fileCount, names: group.fileNames },
  parsed:
    group.type === 'show'
      ? { show: group.parsed.title, year: group.parsed.year }
      : { title: group.parsed.title, year: group.parsed.year },
  tried: group.tried,
})

/** A lookup's first message: the question, then the group's facts as JSON. */
export const askFor = (group: AiGroup): string =>
  `Which TMDB ${group.type} are these files?\n\n${JSON.stringify(factsOf(group), null, 2)}`
