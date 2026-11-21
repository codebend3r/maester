import { type Letter, LETTERS, letterOf } from '@raven/core'

const rankOf = (letter: Letter): number => LETTERS.indexOf(letter)

type FirstAtLetterProps = { names: readonly string[]; letter: Letter }

/**
 * Where the A to Z rail jumps for `letter`: the first name filed under it, else the first filed
 * under a letter after it, else null when none is.
 */
export const firstAtLetter = ({ names, letter }: FirstAtLetterProps): number | null => {
  const rank = rankOf(letter)
  const at = names.findIndex((name) => rankOf(letterOf(name)) >= rank)
  return at === -1 ? null : at
}
