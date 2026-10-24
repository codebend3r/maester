import { type Library, isScanning } from '@raven/core'

/** While a scan counts files, so the counts climb live. */
export const SCAN_POLL_MS = 1500

/**
 * While a Refresh asks for ratings; each answer moves the count, but no
 * faster than this matters.
 */
export const RATINGS_POLL_MS = 5000

/**
 * A timer past about 24 days overflows and fires at once, and a wait is
 * never longer than a day.
 */
const LONGEST_WAIT_MS = 24 * 60 * 60 * 1000

const delayOf = ({ library, now }: { library: Library; now: number }): number | false => {
  if (isScanning(library.scan)) return SCAN_POLL_MS
  const { ratingsRefresh } = library
  switch (ratingsRefresh.state) {
    case 'idle':
      return false
    case 'running':
      return RATINGS_POLL_MS
    case 'waiting': {
      // Nothing moves until it resumes, so it is read once then, not on a clock.
      const until = Date.parse(ratingsRefresh.resumesAt) - now
      if (Number.isNaN(until)) return RATINGS_POLL_MS
      return Math.min(Math.max(until, RATINGS_POLL_MS), LONGEST_WAIT_MS)
    }
    default: {
      const unreachable: never = ratingsRefresh
      return unreachable
    }
  }
}

/**
 * How long until the libraries shown are read again, or false when nothing
 * in them is moving: the soonest any of them needs, a scan's every 1.5 s, a
 * running Update ratings' every 5 s, and a waiting one's when it resumes.
 */
export const libraryPollDelay = ({
  libraries,
  now = Date.now(),
}: {
  libraries: readonly Library[]
  now?: number
}): number | false =>
  libraries.reduce<number | false>((soonest, library) => {
    const delay = delayOf({ library, now })
    if (delay === false) return soonest
    return soonest === false ? delay : Math.min(soonest, delay)
  }, false)
