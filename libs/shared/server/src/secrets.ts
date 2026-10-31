import { timingSafeEqual } from 'node:crypto'

type SameSecretProps = { given: string; expected: string }

/**
 * Whether `given` matches `expected`, in time that does not depend on where
 * they differ. Padding gives `timingSafeEqual` equal-length buffers without
 * hashing passwords; the byte lengths distinguish trailing NUL characters.
 */
export const sameSecret = ({ given, expected }: SameSecretProps): boolean => {
  const givenBytes = Buffer.from(given)
  const expectedBytes = Buffer.from(expected)
  const size = Math.max(givenBytes.length, expectedBytes.length)
  const paddedGiven = Buffer.alloc(size)
  const paddedExpected = Buffer.alloc(size)
  givenBytes.copy(paddedGiven)
  expectedBytes.copy(paddedExpected)
  const matches = timingSafeEqual(paddedGiven, paddedExpected)
  return matches && givenBytes.length === expectedBytes.length
}
