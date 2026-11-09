import { basename } from 'node:path'
import { foldTitle } from '@raven/core'
import { albumFolderOf } from '@/music/filing'

/** Words that mark a bracketed part of a title as the edition, not the album's name. */
const EDITION_WORDS =
  /\b(?:deluxe|edition|expanded|remaster(?:ed|s)?|anniversary|bonus|explicit|reissue|special|limited|platinum|extended|version|cdm|japanese|import|clean|dirty|lyrics?|super|collector'?s?|\d+\s*cd|disc\s*\d+|cd\s*\d+)\b/i

/** A bracketed part of a title: "(Deluxe Edition)", "[Explicit Lyrics]". */
const BRACKETED = /\s*[([{]([^)\]}]*)[)\]}]?/g

/** A disc named before the title: "Disc 1: Havoc And Bright Lights". */
const LEADING_DISC = /^(?:disc|disk|cd)\s*\d+\s*[:\-.]\s*/i

/** Words that only ever lead into "Edition" or "Reissue": "10th Anniversary", "Super Deluxe". */
const EDITION_LEAD =
  "(?:\\d+(?:st|[nr]d|th)|first|second|third|fifth|tenth|\\w+teenth|\\w+ieth|anniversary|deluxe|special|limited|expanded|collector'?s|platinum|gold|super|definitive|european|japanese|target|remastered|bonus|digital)"

/**
 * An edition named after the title with no brackets: after a colon any words
 * before "Edition" ("Ohio Players: Trophy Edition"), else only words that
 * lead into one ("Brothers 10th Anniversary Edition"), and "Deluxe", "CDM",
 * "2CD" or "Disc 1" alone.
 */
const TRAILING_EDITION = new RegExp(
  [
    "\\s*:\\s*(?:the\\s+)?(?:[\\w']+\\s+){0,3}(?:edition|reissue|remastered)",
    `\\s+(?:${EDITION_LEAD}\\s+){0,3}(?:edition|reissue|remastered)`,
    '\\s+(?:deluxe|cdm|\\d?cd|(?:disc|disk|cd)\\s*\\d+)',
  ]
    .map((branch) => `(?:${branch})`)
    .join('|')
    .replace(/^(.*)$/, '(?:$1)$'),
  'i',
)

/** A year in brackets at the end of a folder's name: "Pac's Life (2006)". */
const FOLDER_YEAR = /\s*[([](\d{4})[)\]]\s*$/

/** "Artist - Title", as a folder names an album. */
const ARTIST_AND_TITLE = /^(.+?)\s+-\s+(.+)$/

/** A bracketed part of the title is the edition's when it names one; else it stays, as in "(What's the Story) Morning Glory?". */
const dropEditionBrackets = (title: string): string =>
  title.replace(BRACKETED, (whole, inside: string) => (EDITION_WORDS.test(inside) ? '' : whole))

/** Takes edition words off the end until none is left. */
const dropTrailingEditions = (title: string): string => {
  const trimmed = title.replace(TRAILING_EDITION, '').trim()
  return trimmed === title || trimmed === '' ? title : dropTrailingEditions(trimmed)
}

/**
 * An album's title without what tells one edition from another: the disc,
 * "Deluxe Edition", "(Bonus Track)", "[Explicit]", underscores for spaces.
 * MusicBrainz files the album under the plain name, which a search for the
 * whole tag misses. The title as it was when nothing is left of it.
 */
export const plainAlbumTitle = (title: string): string => {
  const spaced = title.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  const plain = dropTrailingEditions(
    dropEditionBrackets(spaced.replace(LEADING_DISC, '')).replace(/\s+/g, ' ').trim(),
  )
  return foldTitle(plain) === '' ? spaced : plain
}

/** What an album's folder says of it: "2Pac - Pac's Life (2006)" names its artist, title and year. */
export type FolderFacts = { artist: string | null; title: string; year: number | null }

/** The album's facts as its folder's name gives them; null for a folder with no name. */
export const folderFactsOf = (path: string): FolderFacts | null => {
  const name = basename(albumFolderOf(path)).replace(/_+/g, ' ').trim()
  if (name === '') return null
  const yearMatch = FOLDER_YEAR.exec(name)
  const withoutYear = name.replace(FOLDER_YEAR, '').trim()
  const named = ARTIST_AND_TITLE.exec(withoutYear)
  return {
    artist: named?.[1]?.trim() ?? null,
    title: plainAlbumTitle(named?.[2]?.trim() ?? withoutYear),
    year: yearMatch?.[1] === undefined ? null : Number(yearMatch[1]),
  }
}

type IsSamePlainTitleProps = { a: string; b: string }

/** Two album titles name one album once their editions are taken off. */
export const isSamePlainTitle = ({ a, b }: IsSamePlainTitleProps): boolean => {
  const folded = foldTitle(plainAlbumTitle(a))
  return folded !== '' && folded === foldTitle(plainAlbumTitle(b))
}
