import {
  type ChoosableImageKind,
  type CreditJob,
  CREDIT_JOBS,
  type ItemType,
  ITEM_TYPES,
  isNumber,
  isRecord,
  isString,
  type MatchItemType,
} from '@raven/core'

/** The path segment TMDB files each type it is looked up as under, and names it by in a credit. */
export const TMDB_SEGMENTS = { movie: 'movie', show: 'tv' } as const satisfies Record<
  MatchItemType,
  string
>

/** The country whose ratings and release dates stand in for one TMDB has none for. */
const COUNTRIES = { us: 'US' } as const

/** The only image paths raven ever fetches: `/abc123.jpg`, nothing that could leave TMDB's CDN. */
export const TMDB_IMAGE_PATH = /^\/[A-Za-z0-9_-]+\.(jpg|png)$/

export type FetchedCredit = {
  tmdbId: string
  name: string
  /** TMDB's path for their photo. */
  photo: string | null
  job: CreditJob
  role: string | null
}

/** One credit on a person's page: a movie or show they acted in or worked on. */
export type FetchedPersonCredit = {
  /** TMDB's own id for the credit, which stays the same between fetches. */
  creditId: string
  type: MatchItemType
  tmdbId: string
  title: string
  released: string | null
  poster: string | null
  genreIds: number[]
  /** TMDB's department for a crew credit, and `Acting` for a cast one. */
  department: string
  /** The character for cast, the job for crew. */
  role: string | null
  /** How many episodes of a show, as TMDB counts them. */
  episodes: number | null
  /** Where it came in TMDB's list: cast first, then crew. */
  position: number
}

/** A person as TMDB describes them, with every credit it lists. */
export type FetchedPerson = {
  tmdbId: string
  name: string
  photo: string | null
  imdbId: string | null
  birthday: string | null
  deathday: string | null
  placeOfBirth: string | null
  biography: string | null
  /** The department TMDB knows them for: `Acting`, `Directing`. */
  knownFor: string | null
  credits: FetchedPersonCredit[]
}

/** A review by a TMDB member, as TMDB hands it on. */
type FetchedReview = {
  tmdbId: string
  author: string
  /** TMDB's path for the avatar; anything else TMDB passes on is dropped. */
  avatar: string | null
  rating: number | null
  content: string
  url: string
  writtenAt: string
}

/** A movie, show, season or episode as TMDB describes it, ready to store. */
export type FetchedItem = {
  type: ItemType
  tmdbId: string
  /** A season's or episode's number. */
  number: number | null
  title: string
  originalTitle: string | null
  year: number | null
  released: string | null
  ended: string | null
  summary: string | null
  tagline: string | null
  contentRating: string | null
  runtime: number | null
  studio: string | null
  genres: string[]
  imdbId: string | null
  tvdbId: string | null
  /** The TMDB collection a movie belongs to; null for one in none, and for anything but a movie. */
  saga: FetchedSaga | null
  images: {
    poster: string | null
    backdrop: string | null
    still: string | null
    /** A movie's or show's title as art: a PNG on a clear ground. */
    logo: string | null
  }
  credits: FetchedCredit[]
  /** TMDB's own score out of 10, when anyone has voted. */
  rating: { value: number; votes: number | null } | null
  reviews: FetchedReview[]
}

/** A TMDB collection: The Lord of the Rings Collection, say. */
export type FetchedSaga = { tmdbId: string; name: string }

/** What a movie stored before raven kept sagas and logos has yet to learn. */
export type MovieExtras = Pick<FetchedItem, 'saga'> & { logo: FetchedItem['images']['logo'] }

/** An item with nothing known of it but what names it, which each use spreads its own over. */
export const BLANK_ITEM: Omit<FetchedItem, 'type' | 'tmdbId' | 'number' | 'title'> = {
  originalTitle: null,
  year: null,
  released: null,
  ended: null,
  summary: null,
  tagline: null,
  contentRating: null,
  runtime: null,
  studio: null,
  genres: [],
  imdbId: null,
  tvdbId: null,
  saga: null,
  images: { poster: null, backdrop: null, still: null, logo: null },
  credits: [],
  rating: null,
  reviews: [],
}

/** One of TMDB's pictures for a movie or show. */
type TmdbImage = {
  path: string
  width: number | null
  height: number | null
  /** ISO 639-1, or null for a picture with no text. */
  language: string | null
}

/** A movie's or show's pictures of each kind Edit images chooses; logos only as PNG files, whose ground is clear. */
export type TmdbImages = Record<ChoosableImageKind, TmdbImage[]>

export type SearchResult = {
  tmdbId: string
  title: string
  originalTitle: string | null
  year: number | null
  overview: string | null
  poster: string | null
  /** TMDB's popularity score, which settles a title two results share. */
  popularity: number | null
  /** A show's countries of origin, `['GB']`; none for a movie, as TMDB's search gives none. */
  countries: string[]
  /** TMDB's genre ids, `[16, 10759]`, which a library's type prefers results by. */
  genreIds: number[]
  /** The language it was made in, as TMDB writes it: `ja`. */
  originalLanguage: string | null
}

/**
 * What Fix match's confidence reads of a result that TMDB's search does not
 * give: a show's seasons and episode counts, or a movie's runtime in
 * minutes, and the other titles TMDB knows it by.
 */
export type MatchFacts =
  | {
      type: typeof ITEM_TYPES.show
      aliases: string[]
      seasons: Array<{ number: number; episodeCount: number }>
      episodeCount: number | null
    }
  | { type: typeof ITEM_TYPES.movie; aliases: string[]; runtime: number | null }

const text = (value: unknown): string | null =>
  isString(value) && value.trim() !== '' ? value.trim() : null

const number = (value: unknown): number | null => (isNumber(value) ? value : null)

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

const records = (value: unknown): Array<Record<string, unknown>> => list(value).filter(isRecord)

const idOf = (value: unknown): string | null => {
  if (isNumber(value)) return String(value)
  return isString(value) && value !== '' ? value : null
}

const imagePath = (value: unknown): string | null => {
  const path = text(value)
  return path != null && TMDB_IMAGE_PATH.test(path) ? path : null
}

export const yearOf = (date: string | null): number | null => {
  const year = Number(date?.slice(0, 4) ?? '')
  return date != null && /^\d{4}/.test(date) && year > 0 ? year : null
}

/** TMDB's pictures that are plain TMDB files, in the order TMDB lists them. */
const toImages = (entries: unknown): TmdbImage[] =>
  records(entries).flatMap((entry) => {
    const path = imagePath(entry.file_path)
    return path == null
      ? []
      : [
          {
            path,
            width: number(entry.width),
            height: number(entry.height),
            language: text(entry.iso_639_1),
          },
        ]
  })

/** A logo raven shows is a PNG, whose ground is clear; an SVG is passed over. */
const isClearLogo = (logo: TmdbImage): boolean => logo.path.endsWith('.png')

/** Every poster, backdrop and clear logo of `/{type}/{id}/images`, in TMDB's order. */
export const toTmdbImages = (body: unknown): TmdbImages => {
  const images = record(body)
  return {
    poster: toImages(images.posters),
    backdrop: toImages(images.backdrops),
    logo: toImages(images.logos).filter(isClearLogo),
  }
}

type PickLogoProps = {
  logos: unknown
  language: string
}

/**
 * The logo a page shows for its title: a clear one, in `language` before
 * one with no language, TMDB's most voted first. Anything not a plain TMDB
 * file is passed over.
 */
export const pickLogo = ({ logos, language }: PickLogoProps): string | null => {
  const clear = toImages(logos).filter(isClearLogo)
  return (
    (
      clear.find((logo) => logo.language === language) ??
      clear.find((logo) => logo.language == null)
    )?.path ?? null
  )
}

type ToLogoProps = {
  body: unknown
  language: string
}

/** The logo among `/{type}/{id}/images`. */
export const toLogo = ({ body, language }: ToLogoProps): string | null =>
  pickLogo({ logos: record(body).logos, language })

/** A movie's `belongs_to_collection`, or null when it belongs to none. */
const toSaga = (value: unknown): FetchedSaga | null => {
  const collection = record(value)
  const tmdbId = idOf(collection.id)
  const name = text(collection.name)
  return tmdbId == null || name == null ? null : { tmdbId, name }
}

type ToMovieExtrasProps = {
  body: unknown
  language: string
}

/** A movie's saga and logo, from `/movie/{id}` with its images appended. */
export const toMovieExtras = ({ body, language }: ToMovieExtrasProps): MovieExtras => {
  const movie = record(body)
  return {
    saga: toSaga(movie.belongs_to_collection),
    logo: pickLogo({ logos: record(movie.images).logos, language }),
  }
}

/** Reviews appended to a movie or show, newest first. */
const toReviews = (reviews: unknown): FetchedReview[] =>
  records(record(reviews).results)
    .flatMap((entry): FetchedReview[] => {
      const tmdbId = text(entry.id)
      const details = record(entry.author_details)
      const author = text(details.name) ?? text(details.username) ?? text(entry.author)
      const content = text(entry.content)
      const writtenAt = text(entry.created_at)
      if (tmdbId == null || author == null || content == null || writtenAt == null) return []
      return [
        {
          tmdbId,
          author,
          avatar: imagePath(details.avatar_path),
          rating: number(details.rating),
          content,
          url: text(entry.url) ?? `https://www.themoviedb.org/review/${tmdbId}`,
          writtenAt,
        },
      ]
    })
    .toSorted((a, b) => b.writtenAt.localeCompare(a.writtenAt))

/** How many cast members are kept, and how many producers. */
const CAST_LIMIT = 50
const PRODUCER_LIMIT = 10

/** TMDB's crew jobs that raven keeps, and what it files each under. */
const CREW_JOBS: Record<string, CreditJob> = {
  Director: CREDIT_JOBS.director,
  Screenplay: CREDIT_JOBS.writer,
  Writer: CREDIT_JOBS.writer,
  Story: CREDIT_JOBS.writer,
  Novel: CREDIT_JOBS.writer,
  Author: CREDIT_JOBS.writer,
  Characters: CREDIT_JOBS.writer,
  Teleplay: CREDIT_JOBS.writer,
  'Original Story': CREDIT_JOBS.writer,
  Producer: CREDIT_JOBS.producer,
}

/** The order a page lists credits in. */
const JOB_ORDER: readonly CreditJob[] = [
  CREDIT_JOBS.cast,
  CREDIT_JOBS.guest,
  CREDIT_JOBS.creator,
  CREDIT_JOBS.director,
  CREDIT_JOBS.writer,
  CREDIT_JOBS.producer,
]

/**
 * Credits in page order: billed cast, then directors, writers and producers.
 * Someone with two jobs of one kind ("Screenplay" and "Story") is one credit
 * with the roles joined.
 */
export const mergeCredits = (credits: readonly FetchedCredit[]): FetchedCredit[] => {
  const merged = credits.reduce((byKey, credit) => {
    const key = `${credit.job}:${credit.tmdbId}`
    const existing = byKey.get(key)
    if (!existing) return byKey.set(key, credit)
    const roles = [existing.role, credit.role].filter(
      (role, index, all): role is string => role != null && all.indexOf(role) === index,
    )
    return byKey.set(key, { ...existing, role: roles.length > 0 ? roles.join(' / ') : null })
  }, new Map<string, FetchedCredit>())
  const ordered = [...merged.values()].toSorted(
    (a, b) => JOB_ORDER.indexOf(a.job) - JOB_ORDER.indexOf(b.job),
  )
  const dropped = new Set(
    ordered.filter((credit) => credit.job === CREDIT_JOBS.producer).slice(PRODUCER_LIMIT),
  )
  return ordered.filter((credit) => !dropped.has(credit))
}

const person = (
  entry: Record<string, unknown>,
): { tmdbId: string; name: string; photo: string | null } | null => {
  const tmdbId = idOf(entry.id)
  const name = text(entry.name)
  return tmdbId != null && name != null
    ? { tmdbId, name, photo: imagePath(entry.profile_path) }
    : null
}

type CastCreditsProps = {
  cast: unknown
  job: typeof CREDIT_JOBS.cast | typeof CREDIT_JOBS.guest
}

const castCredits = ({ cast, job }: CastCreditsProps): FetchedCredit[] =>
  records(cast)
    .toSorted((a, b) => (number(a.order) ?? 0) - (number(b.order) ?? 0))
    .slice(0, CAST_LIMIT)
    .flatMap((entry) => {
      const found = person(entry)
      return found ? [{ ...found, job, role: text(entry.character) }] : []
    })

const crewCredits = (crew: unknown): FetchedCredit[] =>
  records(crew).flatMap((entry) => {
    const found = person(entry)
    const role = text(entry.job)
    const job = role == null ? undefined : CREW_JOBS[role]
    return found && job ? [{ ...found, job, role }] : []
  })

type MovieCertificationProps = {
  releaseDates: unknown
  country: string
}

/**
 * The content rating for `country`, then for the US: the theatrical
 * release's certification first, any other after.
 */
const movieCertification = ({
  releaseDates,
  country,
}: MovieCertificationProps): { rating: string | null; released: string | null } => {
  const forCountry = (code: string) => {
    const dates = records(
      records(record(releaseDates).results).find((entry) => entry.iso_3166_1 === code)
        ?.release_dates ?? null,
    ).toSorted((a, b) => (number(a.type) === 3 ? -1 : 0) - (number(b.type) === 3 ? -1 : 0))
    return {
      rating:
        dates.map((entry) => text(entry.certification)).find((value) => value != null) ?? null,
      released: text(dates[0]?.release_date ?? null)?.slice(0, 10) ?? null,
    }
  }
  const local = forCountry(country)
  const fallback = country === COUNTRIES.us ? local : forCountry(COUNTRIES.us)
  return { rating: local.rating ?? fallback.rating, released: local.released }
}

/** TMDB's own score of a movie, show, season or episode body; null when nobody has voted. */
export const tmdbRating = (body: unknown): FetchedItem['rating'] => {
  const entry = record(body)
  const value = number(entry.vote_average)
  const votes = number(entry.vote_count)
  return value != null && votes != null && votes > 0 ? { value, votes } : null
}

type ShowCertificationProps = {
  ratings: unknown
  country: string
}

/** The content rating for `country`, then for the US, from a show's `content_ratings`. */
const showCertification = ({ ratings, country }: ShowCertificationProps): string | null => {
  const results = records(record(ratings).results)
  const forCountry = (code: string) =>
    results
      .map((entry) => (entry.iso_3166_1 === code ? text(entry.rating) : null))
      .find((value) => value != null) ?? null
  return forCountry(country) ?? forCountry(COUNTRIES.us)
}

/** TMDB's statuses for a show that will air no more. */
const OVER: ReadonlySet<string> = new Set(['Ended', 'Canceled'])

/** Credits over a show's whole run: each person's first role, and each crew job raven keeps. */
const aggregateCredits = (credits: Record<string, unknown>): FetchedCredit[] => [
  ...castCredits({
    cast: records(credits.cast).map((entry) => ({
      ...entry,
      character: text(records(entry.roles)[0]?.character ?? null),
    })),
    job: CREDIT_JOBS.cast,
  }),
  ...records(credits.crew).flatMap((entry) =>
    records(entry.jobs).flatMap((job) => crewCredits([{ ...entry, job: job.job }])),
  ),
]

type ToShowProps = {
  body: unknown
  country: string
  /** ISO 639-1, for the logo: `en`. */
  language: string
}

/** A show with its aggregate credits, content ratings, external ids and images appended. */
export const toShow = ({ body, country, language }: ToShowProps): FetchedItem | null => {
  const show = record(body)
  const tmdbId = idOf(show.id)
  const title = text(show.name)
  if (tmdbId == null || title == null) return null
  const first = text(show.first_air_date)
  const status = text(show.status) ?? ''
  const external = record(show.external_ids)
  const creators = records(show.created_by).flatMap((entry) => {
    const found = person(entry)
    return found ? [{ ...found, job: CREDIT_JOBS.creator, role: 'Creator' }] : []
  })
  return {
    type: ITEM_TYPES.show,
    tmdbId,
    number: null,
    title,
    originalTitle: text(show.original_name),
    year: yearOf(first),
    released: first,
    ended: OVER.has(status) ? text(show.last_air_date) : null,
    summary: text(show.overview),
    tagline: text(show.tagline),
    contentRating: showCertification({ ratings: show.content_ratings, country }),
    runtime: number(list(show.episode_run_time)[0]) || null,
    studio: text(records(show.networks)[0]?.name ?? null),
    genres: records(show.genres).flatMap((genre) => text(genre.name) ?? []),
    imdbId: text(external.imdb_id),
    tvdbId: idOf(external.tvdb_id),
    saga: null,
    images: {
      poster: imagePath(show.poster_path),
      backdrop: imagePath(show.backdrop_path),
      still: null,
      logo: pickLogo({ logos: record(show.images).logos, language }),
    },
    credits: mergeCredits([...creators, ...aggregateCredits(record(show.aggregate_credits))]),
    rating: tmdbRating(show),
    reviews: toReviews(show.reviews),
  }
}

/** An episode as a season's listing gives it: its still, guest stars and crew. */
const toEpisode = (entry: Record<string, unknown>): FetchedItem | null => {
  const tmdbId = idOf(entry.id)
  const episode = number(entry.episode_number)
  if (tmdbId == null || episode == null) return null
  const aired = text(entry.air_date)
  return {
    ...BLANK_ITEM,
    type: ITEM_TYPES.episode,
    tmdbId,
    number: episode,
    title: text(entry.name) ?? `Episode ${episode}`,
    year: yearOf(aired),
    released: aired,
    summary: text(entry.overview),
    runtime: number(entry.runtime) || null,
    images: { ...BLANK_ITEM.images, still: imagePath(entry.still_path) },
    credits: mergeCredits([
      ...castCredits({ cast: entry.guest_stars, job: CREDIT_JOBS.guest }),
      ...crewCredits(entry.crew),
    ]),
    rating: tmdbRating(entry),
  }
}

/** A season with its episodes, from `/tv/{id}/season/{n}`. */
export const toSeason = (
  body: unknown,
): { season: FetchedItem; episodes: FetchedItem[] } | null => {
  const season = record(body)
  const tmdbId = idOf(season.id)
  const seasonNumber = number(season.season_number)
  if (tmdbId == null || seasonNumber == null) return null
  const aired = text(season.air_date)
  return {
    season: {
      ...BLANK_ITEM,
      type: ITEM_TYPES.season,
      tmdbId,
      number: seasonNumber,
      title: text(season.name) ?? (seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`),
      year: yearOf(aired),
      released: aired,
      summary: text(season.overview),
      images: { ...BLANK_ITEM.images, poster: imagePath(season.poster_path) },
    },
    episodes: records(season.episodes).flatMap((entry) => toEpisode(entry) ?? []),
  }
}

type ToMovieProps = {
  body: unknown
  country: string
  /** ISO 639-1, for the logo: `en`. */
  language: string
}

/** A movie with its credits, release dates and external ids appended. */
export const toMovie = ({ body, country, language }: ToMovieProps): FetchedItem | null => {
  const movie = record(body)
  const tmdbId = idOf(movie.id)
  const title = text(movie.title)
  if (tmdbId == null || title == null) return null
  const primary = text(movie.release_date)
  const certification = movieCertification({ releaseDates: movie.release_dates, country })
  const credits = record(movie.credits)
  const extras = toMovieExtras({ body, language })
  return {
    type: ITEM_TYPES.movie,
    tmdbId,
    number: null,
    title,
    originalTitle: text(movie.original_title),
    year: yearOf(primary),
    released: primary ?? certification.released,
    ended: null,
    summary: text(movie.overview),
    tagline: text(movie.tagline),
    contentRating: certification.rating,
    runtime: number(movie.runtime) || null,
    studio: text(records(movie.production_companies)[0]?.name ?? null),
    genres: records(movie.genres).flatMap((genre) => text(genre.name) ?? []),
    imdbId: text(record(movie.external_ids).imdb_id) ?? text(movie.imdb_id),
    tvdbId: null,
    saga: extras.saga,
    images: {
      poster: imagePath(movie.poster_path),
      backdrop: imagePath(movie.backdrop_path),
      still: null,
      logo: extras.logo,
    },
    credits: mergeCredits([
      ...castCredits({ cast: credits.cast, job: CREDIT_JOBS.cast }),
      ...crewCredits(credits.crew),
    ]),
    rating: tmdbRating(movie),
    reviews: toReviews(movie.reviews),
  }
}

/** The type a credit's `media_type` names, or null for one raven does not keep. */
const mediaTypeOf = (value: unknown): MatchItemType | null => {
  if (value === TMDB_SEGMENTS.movie) return ITEM_TYPES.movie
  if (value === TMDB_SEGMENTS.show) return ITEM_TYPES.show
  return null
}

type ToPersonCreditProps = {
  entry: Record<string, unknown>
  department: string
  role: string | null
}

/** One entry of `combined_credits`, or null for one raven leaves out. */
const toPersonCredit = ({
  entry,
  department,
  role,
}: ToPersonCreditProps): Omit<FetchedPersonCredit, 'position'> | null => {
  const type = mediaTypeOf(entry.media_type)
  const creditId = idOf(entry.credit_id)
  const tmdbId = idOf(entry.id)
  const title = text(entry.title) ?? text(entry.name)
  if (type == null || creditId == null || tmdbId == null || title == null) return null
  if (entry.adult === true) return null
  return {
    creditId,
    type,
    tmdbId,
    title,
    released: text(entry.release_date) ?? text(entry.first_air_date),
    poster: imagePath(entry.poster_path),
    genreIds: list(entry.genre_ids).filter(isNumber),
    department,
    role,
    episodes: number(entry.episode_count),
  }
}

/**
 * A person with their `combined_credits` and `external_ids` appended, cast
 * before crew. A credit TMDB lists twice keeps its first place.
 */
export const toPerson = (body: unknown): FetchedPerson | null => {
  const details = record(body)
  const found = person(details)
  if (!found) return null
  const combined = record(details.combined_credits)
  const listed = [
    ...records(combined.cast).map((entry) => ({
      entry,
      department: 'Acting',
      role: text(entry.character),
    })),
    ...records(combined.crew).map((entry) => ({
      entry,
      department: text(entry.department) ?? 'Crew',
      role: text(entry.job),
    })),
  ]
    .flatMap((source) => toPersonCredit(source) ?? [])
    .reduce(
      (byId, credit) => (byId.has(credit.creditId) ? byId : byId.set(credit.creditId, credit)),
      new Map<string, Omit<FetchedPersonCredit, 'position'>>(),
    )
  return {
    ...found,
    imdbId: text(details.imdb_id) ?? text(record(details.external_ids).imdb_id),
    birthday: text(details.birthday),
    deathday: text(details.deathday),
    placeOfBirth: text(details.place_of_birth),
    biography: text(details.biography),
    knownFor: text(details.known_for_department),
    credits: [...listed.values()].map((credit, position) => ({ ...credit, position })),
  }
}

const toSearchResult = (entry: Record<string, unknown>): SearchResult | null => {
  const tmdbId = idOf(entry.id)
  const title = text(entry.title) ?? text(entry.name)
  if (tmdbId == null || title == null) return null
  return {
    tmdbId,
    title,
    originalTitle: text(entry.original_title) ?? text(entry.original_name),
    year: yearOf(text(entry.release_date) ?? text(entry.first_air_date)),
    overview: text(entry.overview),
    poster: imagePath(entry.poster_path),
    popularity: number(entry.popularity),
    countries: list(entry.origin_country).filter(isString),
    genreIds: list(entry.genre_ids).filter(isNumber),
    originalLanguage: text(entry.original_language),
  }
}

/** The results of a `/search/movie` or `/search/tv` body, those TMDB named. */
export const toSearchResults = (body: unknown): SearchResult[] =>
  records(record(body).results).flatMap((entry) => toSearchResult(entry) ?? [])

/** TMDB's ids among a `/find/{id}` body, by kind. */
export const toFoundIds = (body: unknown): { movies: string[]; shows: string[] } => {
  const found = record(body)
  const ids = (results: unknown): string[] =>
    records(results).flatMap((entry) => idOf(entry.id) ?? [])
  return { movies: ids(found.movie_results), shows: ids(found.tv_results) }
}

/** The other titles in an `alternative_titles` body: a movie's come as `titles`, a show's as `results`. */
export const toAlternativeTitles = (body: unknown): string[] => {
  const titled = record(body)
  return records(titled.titles ?? titled.results).flatMap((entry) => text(entry.title) ?? [])
}

type ToMatchFactsProps = {
  body: unknown
  /** The type the facts are for. */
  type: MatchItemType
  /** The type TMDB was asked as; a movie catalogued as a TV documentary has no movie runtime. */
  asked: MatchItemType
}

/** A movie's or show's details with `alternative_titles` appended, as Fix match's confidence reads them. */
export const toMatchFacts = ({ body, type, asked }: ToMatchFactsProps): MatchFacts => {
  const details = record(body)
  const aliases = toAlternativeTitles(details.alternative_titles)
  if (type === ITEM_TYPES.movie) {
    return { type, aliases, runtime: asked === type ? number(details.runtime) || null : null }
  }
  return {
    type,
    aliases,
    seasons: records(details.seasons).flatMap((season) => {
      const seasonNumber = number(season.season_number)
      const episodeCount = number(season.episode_count)
      return seasonNumber == null || episodeCount == null
        ? []
        : [{ number: seasonNumber, episodeCount }]
    }),
    episodeCount: number(details.number_of_episodes),
  }
}
