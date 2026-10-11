/**
 * What a file's name says it is, read the way Radarr, Sonarr, Plex and scene
 * releases write names. Pure string work, so the server's matcher and any
 * client agree on what a name means.
 */

/** Ids a name carries: Plex's `{tmdb-603}` or Jellyfin's and Radarr's `[tmdbid-603]`. */
export type NameIds = {
  tmdb: string | null
  imdb: string | null
  tvdb: string | null
}

export type ParsedMovieName = {
  title: string
  year: number | null
  /** Plex's `{edition-Director's Cut}`, or an edition named bare in the title: `Avatar Theatrical Cut`, `Spy (Extended)`. */
  edition: string | null
  ids: NameIds
}

const NO_IDS: NameIds = { tmdb: null, imdb: null, tvdb: null }

const ID_PATTERN = /\{(tmdb|imdb|tvdb)-([^}\s]+)\}|\[(tmdb|imdb|tvdb)id[-=]([^\]\s]+)\]/gi

const EDITION_PATTERN = /\{edition-([^}]+)\}/i

/**
 * An edition named in the title itself, as Radarr's `{Edition Tags}` or a
 * hand-named file puts it, at the end, in brackets or bare: `(Extended Cut)`,
 * `Directors Cut`, `(Unrated)`, `20th Anniversary Edition`.
 */
const EDITION_WORDS =
  "director'?s|extended|theatrical|final|ultimate|unrated|uncut|special|collector'?s|anniversary|remastered|definitive|redux|imax|\\d+(?:st|[nr]d|th) anniversary"
const BARE_EDITION = new RegExp(
  `^(.*?)[\\s(\\[]+((?:${EDITION_WORDS})(?: (?:cut|edition|version))?|(?:cut|edition|version))[)\\]]*$`,
  'i',
)

/** The edition a title names at its end, and the title without it. */
const readBareEdition = (title: string): { title: string; edition: string | null } => {
  const found = BARE_EDITION.exec(title)
  const rest = found?.[1]?.trim() ?? ''
  const edition = found?.[2]?.trim() ?? null
  // A lone "Cut" or "Edition" only counts in brackets, as "The Final Cut" is a film.
  const bracketed = found != null && /[([]/.test(title.slice(rest.length))
  if (
    edition == null ||
    rest === '' ||
    /^(the|a|an)$/i.test(rest) ||
    (!bracketed && /^(cut|edition|version)$/i.test(edition))
  ) {
    return { title, edition: null }
  }
  return { title: tidy(rest), edition }
}

/**
 * Words that start the release details in a name: resolutions, sources,
 * codecs and fixes. Matched against each word of a scene name, and against
 * each half of Radarr's `Bluray-1080p`.
 */
const RELEASE_TAG =
  /^(2160p|1080p|720p|480p|576p|blu-?ray|remux|web-?dl|webrip|web|hdtv|dvdrip|bdrip|brrip|x26[45]|h26[45]|hevc|av1|hdr|hdr10|dv|uhd|proper|repack)$/i

const isReleaseTag = (word: string): boolean =>
  word.startsWith('[') || word.split('-').some((part) => RELEASE_TAG.test(part))

const plausibleYear = (year: number): boolean => year >= 1880 && year <= 2100

/** The ids in `name`, the earlier of two of a kind winning. */
const readIds = (name: string): NameIds => {
  const found = [...name.matchAll(ID_PATTERN)].map((match) => ({
    kind: (match[1] ?? match[3] ?? '').toLowerCase(),
    value: match[2] ?? match[4] ?? '',
  }))
  const first = (kind: string): string | null => found.find((id) => id.kind === kind)?.value ?? null
  return { tmdb: first('tmdb'), imdb: first('imdb'), tvdb: first('tvdb') }
}

const mergeIds = (first: NameIds, second: NameIds): NameIds => ({
  tmdb: first.tmdb ?? second.tmdb,
  imdb: first.imdb ?? second.imdb,
  tvdb: first.tvdb ?? second.tvdb,
})

const stripTags = (name: string): string =>
  name.replace(ID_PATTERN, ' ').replace(new RegExp(EDITION_PATTERN.source, 'gi'), ' ')

const stemOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 && fileName.length - dot <= 5 ? fileName.slice(0, dot) : fileName
}

/** Scene names separate words with dots or underscores; a name with spaces keeps its own. */
const spaced = (text: string): string =>
  (text.includes(' ') ? text : text.replace(/[._]+/g, ' ')).replace(/\s+/g, ' ')

/** Separators and openers left dangling where the name was cut. */
const tidy = (text: string): string =>
  spaced(text)
    .replace(/^[\s\-_.([]+/, '')
    .replace(/[\s\-_.([]+$/, '')
    .trim()

/** Where the year sits: the last `(YYYY)`, else the last bare year that release tags follow. */
const findYear = (name: string): { year: number; at: number } | null => {
  const bracketed = [...name.matchAll(/\((\d{4})\)/g)].findLast((match) =>
    plausibleYear(Number(match[1])),
  )
  if (bracketed?.index != null) return { year: Number(bracketed[1]), at: bracketed.index }

  const bare = [...name.matchAll(/(?<=^|[\s._\-[(])((?:19|20)\d{2})(?=$|[\s._\-\])])/g)].findLast(
    (match) => {
      const at = match.index ?? 0
      if (at === 0) return false
      const rest = name.slice(at + 4).replace(/^[\s._\-\])]+/, '')
      const next = rest.split(/[\s._]+/)[0] ?? ''
      return rest === '' || isReleaseTag(next)
    },
  )
  return bare?.index != null ? { year: Number(bare[1]), at: bare.index } : null
}

/** Where the release details start in a name without a year, or its length. */
const firstTagAt = (name: string): number => {
  const found = [...name.matchAll(/[^\s._]+/g)].find((word) => isReleaseTag(word[0]))
  return found?.index ?? name.length
}

/** A title sorted by hand, "Whale, The", with its article back in front: "The Whale". */
const unsortTitle = (title: string): string => {
  const sorted = /^(.+?),\s+(the|a|an)$/i.exec(title)
  return sorted ? `${sorted[2]} ${sorted[1]}` : title
}

/** A DVD region code left in a title: `Alien Resurrection R2`. */
const REGION_TAG = /\s+R[1-6]$/i

/**
 * A title that repeats its own year ends there: `Alexander 2004 Revisited
 * the Final Cut (2004)` is `Alexander`. A year that is the title, `2012`,
 * or a different number, `Blade Runner 2049`, stays.
 */
const beforeOwnYear = ({ title, year }: { title: string; year: number | null }): string => {
  if (year == null) return title
  const at = title.search(new RegExp(`(?<=\\s)${year}(?=\\s|$)`))
  return at > 0 ? tidy(title.slice(0, at)) : title
}

/** Reads one name, a folder's or a file's stem: title, year, edition and ids. */
const readName = (name: string): ParsedMovieName => {
  const ids = readIds(name)
  const edition = EDITION_PATTERN.exec(name)?.[1]?.trim() ?? null
  const bare = stripTags(name)
  const year = findYear(bare)
  const named = readBareEdition(tidy(bare.slice(0, year ? year.at : firstTagAt(bare))))
  const title = beforeOwnYear({ title: named.title, year: year?.year ?? null }).replace(
    REGION_TAG,
    '',
  )
  return {
    title: unsortTitle(title),
    year: year?.year ?? null,
    edition: edition ?? named.edition,
    ids,
  }
}

/** The last segment of a relative folder, or '' at a library's root. */
const lastSegment = (folder: string): string =>
  folder.split(/[\\/]/).findLast((segment) => segment !== '') ?? ''

/**
 * A movie's title, year, edition and ids. Its own folder is read first when
 * that folder's name has a year, the way Radarr names folders; otherwise the
 * file's name is. Ids and editions are taken from either.
 */
export const parseMovieName = ({
  fileName,
  folder,
}: {
  fileName: string
  folder: string
}): ParsedMovieName => {
  const fromFile = readName(stemOf(fileName))
  const folderName = lastSegment(folder)
  const fromFolder = folderName ? readName(folderName) : null
  const useFolder = fromFolder?.year != null && fromFolder.title !== ''
  const chosen = useFolder && fromFolder ? fromFolder : fromFile
  return {
    title: chosen.title || tidy(stemOf(fileName)) || fileName,
    year: chosen.year,
    edition: fromFile.edition ?? fromFolder?.edition ?? null,
    ids: mergeIds(fromFile.ids, fromFolder?.ids ?? NO_IDS),
  }
}

/** Plex's folders for extras, which belong to a movie or show but are not it. */
const EXTRAS_FOLDERS: ReadonlySet<string> = new Set([
  'behind the scenes',
  'deleted scenes',
  'featurettes',
  'interviews',
  'scenes',
  'shorts',
  'trailers',
  'extras',
  'other',
])

const EXTRAS_SUFFIX = /-(trailer|featurette|behindthescenes|deleted|interview|scene|short|other)$/i

/** A trailer, featurette or other extra, by Plex's folder names and suffixes: never matched. */
export const isExtra = ({ fileName, folder }: { fileName: string; folder: string }): boolean =>
  folder.split(/[\\/]/).some((segment) => EXTRAS_FOLDERS.has(segment.trim().toLowerCase())) ||
  EXTRAS_SUFFIX.test(stemOf(fileName))

const LEADING_ARTICLE = /^(the|a|an)\s+/i

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
}

/**
 * A title folded for comparison: no case, accents or punctuation, `&` as
 * "and", a number spelt out as its digits, and no leading "The", "A" or
 * "An", so "The Lord of the Rings: The Return of the King" and "lord of the
 * rings the return of the king" agree, as do "Fantastic Four" and
 * "Fantastic 4". An apostrophe goes without a trace, so "The King's Man" is
 * "The Kings Man".
 */
export const foldTitle = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(LEADING_ARTICLE, '')
    .split(' ')
    .map((word) => NUMBER_WORDS[word] ?? word)
    .join(' ')
    .trim()

/** A title as it sorts: without a leading "The", "A" or "An". */
export const sortTitle = (title: string): string => title.trim().replace(LEADING_ARTICLE, '')

export type ParsedEpisodeName = {
  show: string
  /** The show as the file itself names it, when that differs from the folder: a misspelt folder, `Muderbot/Murderbot - S01E01.mkv`. */
  showFromFile: string | null
  /** The show's year, from its folder or the name: "Severance (2022)". */
  year: number | null
  season: number | null
  /** One number, or two for a file holding two episodes; none when the name has no code. */
  episodes: number[]
  /** The episode's own title when the name carries one: "Half Loop". */
  title: string | null
  ids: NameIds
  /** An anime absolute number, `(0123)`, read but not matched on yet. */
  absolute: number | null
  /** An air date in the name, `2026.10.09`, read but not matched on yet. */
  airDate: string | null
}

/** The number a season folder names: `Season 1`, `Season 01`, or 0 for `Specials`; null for any other folder. */
export const seasonFolderNumber = (name: string): number | null => {
  const trimmed = name.trim()
  if (/^specials$/i.test(trimmed)) return 0
  const match = /^(?:season|series|staffel|saison)\s*(\d{1,3})$/i.exec(trimmed)
  return match ? Number(match[1]) : null
}

/** Sonarr's country suffix telling two shows of a name apart: `Euphoria (US)`, `The Office (UK)`. */
const COUNTRY_SUFFIX =
  /\s*\((?:US|UK|AU|CA|NZ|IE|JP|KR|FR|DE|IT|ES|BR|MX|IN|CN|SE|NO|DK|NL|BE|PL|RU|TR|ZA)\)$/i

/** `S01E02`, `S1E2`, `S01E123`, `S01E01-E02`, `S01E01E02`, and `1x02`. */
const EPISODE_CODE =
  /(?<![A-Za-z0-9])(?:S(\d{1,2})[ ._-]?E(\d{1,3})(?:(?:[ ._-]?E|-E?|E)(\d{1,3}))?|(?<!\d)(\d{1,2})x(\d{2,3}))(?![A-Za-z0-9])/i

const ABSOLUTE = /\((\d{3,4})\)/
const AIR_DATE = /(?<!\d)((?:19|20)\d{2})[.-](\d{2})[.-](\d{2})(?!\d)/

/** One episode number, or the run from `first` to `second` when they read as a range. */
const episodeRun = ({ first, second }: { first: number; second: number | null }): number[] => {
  if (second == null) return [first]
  if (second > first && second - first < 50) {
    return Array.from({ length: second - first + 1 }, (_, index) => first + index)
  }
  return second === first ? [first] : [first, second]
}

/**
 * What an episode's name says: the show (its folder first, then the file
 * name, then `fallbackShow`, the library folder's own name), the season
 * and episode numbers, and the episode's title when there is one.
 */
export const parseEpisodeName = ({
  fileName,
  folder,
  fallbackShow = '',
}: {
  fileName: string
  folder: string
  fallbackShow?: string
}): ParsedEpisodeName => {
  const stem = stripTags(stemOf(fileName))
  const ids = mergeIds(readIds(fileName), readIds(folder))
  const segments = folder.split(/[\\/]/).filter((segment) => segment !== '')
  const showFolder = segments[0] ?? ''
  const seasonFolder = segments.map(seasonFolderNumber).findLast((number) => number != null) ?? null

  const code = EPISODE_CODE.exec(stem)
  const before = code ? stem.slice(0, code.index) : stem
  const after = code ? stem.slice(code.index + code[0].length) : ''
  const absolute = ABSOLUTE.exec(before)
  const airDate = AIR_DATE.exec(stem)

  const fromFile = readName(before.replace(ABSOLUTE, ' ').replace(AIR_DATE, ' '))
  const fromFolder =
    showFolder !== '' && seasonFolderNumber(showFolder) == null ? readName(showFolder) : null
  const show = (fromFolder?.title || fromFile.title || fallbackShow).replace(COUNTRY_SUFFIX, '')
  const fileShow = fromFile.title.replace(COUNTRY_SUFFIX, '')
  const showFromFile = fileShow !== '' && fileShow !== show ? fileShow : null

  const season = code ? Number(code[1] ?? code[4]) : seasonFolder
  const episodes = code
    ? episodeRun({
        first: Number(code[2] ?? code[5]),
        second: code[3] == null ? null : Number(code[3]),
      })
    : []
  const title = code ? tidy(after.slice(0, firstTagAt(after))) || null : null

  return {
    show,
    showFromFile,
    year: fromFolder?.year ?? fromFile.year,
    season,
    episodes,
    title,
    ids,
    absolute: absolute ? Number(absolute[1]) : null,
    airDate: airDate ? `${airDate[1]}-${airDate[2]}-${airDate[3]}` : null,
  }
}
