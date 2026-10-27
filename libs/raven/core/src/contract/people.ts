import { isCreditJob, isItemSummary, isMatchItemType } from '@/contract/items'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

/** What TMDB says of a person; every field is null when it has nothing. */
export const isPersonProfile = object({
  imdbId: nullable(isString),
  /** `YYYY-MM-DD`. */
  birthday: nullable(isString),
  /** `YYYY-MM-DD`. */
  deathday: nullable(isString),
  placeOfBirth: nullable(isString),
  biography: nullable(isString),
  knownFor: nullable(isString),
})

export type PersonProfile = Infer<typeof isPersonProfile>

/** The kind of work a credit is: TMDB's departments, folded to the ones a filmography tabs by. */
export const isFilmographyDepartment = oneOf([
  'acting',
  'directing',
  'writing',
  'producing',
  'crew',
])

export type FilmographyDepartment = Infer<typeof isFilmographyDepartment>

/** One part a person played in a title; a title can hold several. */
export const isFilmographyCredit = object({
  department: isFilmographyDepartment,
  role: nullable(isString),
  /** How many episodes of a show the credit covers, when TMDB says. */
  episodes: nullable(isNumber),
  /** Whether they appear as themselves, as on a talk show. */
  isSelf: isBoolean,
})

export type FilmographyCredit = Infer<typeof isFilmographyCredit>

/** A movie or show a person is credited on in TMDB, and the item in raven when it holds one. */
export const isFilmographyEntry = object({
  type: isMatchItemType,
  tmdbId: isString,
  title: isString,
  year: nullable(isNumber),
  /** `YYYY-MM-DD`, or the part TMDB knows. */
  released: nullable(isString),
  /** TMDB's poster path, served through `/api/images/poster`. */
  poster: nullable(isString),
  credits: listOf(isFilmographyCredit),
  item: nullable(isItemSummary),
})

export type FilmographyEntry = Infer<typeof isFilmographyEntry>

/**
 * A person's whole TMDB filmography: `ready` with its entries, `pending`
 * while the server fetches it, or `unavailable` when TMDB is not configured
 * or cannot be reached.
 */
export const FILMOGRAPHY_STATES = {
  ready: 'ready',
  pending: 'pending',
  unavailable: 'unavailable',
} as const

export const isPersonFilmography = union(
  object({
    state: oneOf([FILMOGRAPHY_STATES.ready]),
    fetchedAt: isString,
    entries: listOf(isFilmographyEntry),
  }),
  object({ state: oneOf([FILMOGRAPHY_STATES.pending]) }),
  object({ state: oneOf([FILMOGRAPHY_STATES.unavailable]) }),
)

export type PersonFilmography = Infer<typeof isPersonFilmography>

/** A person's page: who they are, and everything in raven they are credited on. */
export const isPersonDetails = object({
  id: isNumber,
  tmdbId: isString,
  name: isString,
  photoVersion: nullable(isString),
  profile: nullable(isPersonProfile),
  filmography: isPersonFilmography,
  /** Movies and shows on disk, newest first. */
  credits: listOf(object({ item: isItemSummary, job: isCreditJob, role: nullable(isString) })),
})

export type PersonDetails = Infer<typeof isPersonDetails>
