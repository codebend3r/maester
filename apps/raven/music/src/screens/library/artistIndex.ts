/** Where an artist whose name starts with no letter files: digits, symbols. */
const OTHER = '#'

/** The A to Z rail's entries, top to bottom. */
export const INDEX_LETTERS = [OTHER, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] as const

const LETTER = /^[A-Z]$/

/** The rail entry a name files under: its first letter without accents, or `#`. */
export const letterOf = (name: string): string => {
  const first = name.normalize('NFD').slice(0, 1).toLocaleUpperCase()
  return LETTER.test(first) ? first : OTHER
}

const rankOf = (letter: string): number => INDEX_LETTERS.findIndex((entry) => entry === letter)

type FirstAtLetterProps = { names: readonly string[]; letter: string }

/**
 * Where the rail jumps for `letter`: the first name filed under it, else the first filed under
 * a letter after it, else null when none is.
 */
export const firstAtLetter = ({ names, letter }: FirstAtLetterProps): number | null => {
  const rank = rankOf(letter)
  const at = names.findIndex((name) => rankOf(letterOf(name)) >= rank)
  return at === -1 ? null : at
}
