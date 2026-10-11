import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (text: string): Buffer => createHash('sha256').update(text).digest()

/**
 * Whether `given` matches `expected`, in time that does not depend on where
 * they differ. Hashing both sides first gives equal lengths, which
 * `timingSafeEqual` needs, so the length leaks nothing either.
 */
export const sameSecret = ({ given, expected }: { given: string; expected: string }): boolean =>
  timingSafeEqual(digest(given), digest(expected))
