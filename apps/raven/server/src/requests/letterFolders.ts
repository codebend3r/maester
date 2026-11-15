import { letterOf, sortTitle } from '@raven/core'

type LetterFolderOfProps = {
  /** The folder whose letter folders the kind goes under: `/Meleys/Movies`. */
  base: string
  title: string
}

/**
 * The letter folder the library files a title under, `/Meleys/Movies/B` for
 * "A Beautiful Mind": its sort title's letter, as the letter picker reads it,
 * so "Émilie" is E and "The 13th Warrior" and "(500) Days of Summer" are `#`.
 */
export const letterFolderOf = ({ base, title }: LetterFolderOfProps): string =>
  `${base}/${letterOf(sortTitle(title))}`
