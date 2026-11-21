/** The parts that say something: neither missing nor empty. */
export const present = (parts: readonly (string | null)[]): string[] =>
  parts.filter((part): part is string => part !== null && part !== '')

type JoinedOrNullProps = { parts: readonly (string | null)[]; separator: string }

/** The parts that say something, joined as one line; null when none does. */
export const joinedOrNull = ({ parts, separator }: JoinedOrNullProps): string | null => {
  const words = present(parts)
  return words.length === 0 ? null : words.join(separator)
}
