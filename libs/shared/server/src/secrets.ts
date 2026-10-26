import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (text: string): Buffer => createHash('sha256').update(text).digest()

type SameSecretProps = { given: string; expected: string }

/**
 * Whether `given` matches `expected`, in time that does not depend on where
 * they differ. Hashing both sides first gives equal lengths, which
 * `timingSafeEqual` needs, so the length leaks nothing either.
 */
export const sameSecret = ({ given, expected }: SameSecretProps): boolean =>
  timingSafeEqual(digest(given), digest(expected))
