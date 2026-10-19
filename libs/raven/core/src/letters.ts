import type { ItemSummary, MediaItem } from '@/contract'
import { sortTitle } from '@/naming'

/** The letter that gathers the titles starting with no letter: numbers, symbols, or nothing. */
export const SPECIAL_LETTERS = { numbers: '#' } as const

/** The letter picker's letters: # for titles that start with no letter, then A to Z. */
export const LETTERS = [
  SPECIAL_LETTERS.numbers,
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
] as const

export type Letter = (typeof LETTERS)[number]

const isLetter = (value: string): value is Letter => LETTERS.some((letter) => letter === value)

/** The letter a title starts with, its accent dropped (Émile is under E), else #. */
export const letterOf = (title: string): Letter => {
  const first = title.trim().normalize('NFD').charAt(0).toUpperCase()
  return first !== SPECIAL_LETTERS.numbers && isLetter(first) ? first : SPECIAL_LETTERS.numbers
}

/**
 * The letter a video files under in a title sort: its movie's title without
 * a leading "The", "A" or "An", as the server sorts matched titles, or the
 * file's own title as it stands.
 */
export const mediaLetter = (media: MediaItem): Letter =>
  letterOf(media.item ? sortTitle(media.item.title) : media.title)

/** The letter a show files under: its title without a leading article. */
export const showLetter = (show: ItemSummary): Letter => letterOf(sortTitle(show.title))
