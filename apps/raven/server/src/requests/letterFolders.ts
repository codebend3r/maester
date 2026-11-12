import { sortTitle } from '@raven/core'

/** The folder a title that opens with no letter goes under, as the library files "10 Cloverfield Lane". */
const NON_LETTER_FOLDER = '#'

/**
 * The letter folder the library files a title under: its sort title's first
 * letter, accents folded and upper case, so "The Bear" is B, "Émilie" is E,
 * and "The 13th Warrior" and "(500) Days of Summer" are `#`.
 */
export const letterOf = (title: string): string => {
  const first = sortTitle(title).normalize('NFD').replace(/\p{M}/gu, '').charAt(0).toUpperCase()
  return /^[A-Z]$/u.test(first) ? first : NON_LETTER_FOLDER
}

type LetterFolderOfProps = {
  /** The folder whose letter folders the kind goes under: `/Meleys/Movies`. */
  base: string
  title: string
}

/** `/Meleys/Movies/B` for "A Beautiful Mind". */
export const letterFolderOf = ({ base, title }: LetterFolderOfProps): string =>
  `${base}/${letterOf(title)}`
