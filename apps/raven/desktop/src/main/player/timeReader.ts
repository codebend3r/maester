import { MPV_TIME_THROTTLE_MS } from '@raven/mpv'
import { createThrottle } from '@/main/player/throttle'
import type { Timers } from '@/main/timers'
import { messageOf } from '@/shared/messageOf'

/** The quiet page hears `time` at most this often, whichever path sends it: the addon's own pace. */
export const TIME_MS = MPV_TIME_THROTTLE_MS

type CreateTimeReaderProps = {
  timers: Timers
  /** Tells the page the time. */
  show: (time: number) => void
  /** Reads mpv's time-pos, null when it has none. */
  read: () => Promise<number | null>
  /** The service's epoch, so a read that answers after another step goes no further. */
  epoch: () => number
  /** Whether a file is loaded, the only time a read asked for meanwhile is worth reading. */
  isLoaded: () => boolean
  /** A read that is still the newest: the service notes it, then shows it. */
  onRead: (time: number) => void
  warn: (message: string) => void
}

export type TimeReader = {
  /** Hands the page a time, sent now or held for the end of the quiet period. */
  show: (time: number) => void
  /** Forgets what was shown and held, as a file opens or closes. */
  clear: () => void
  /** A seek went out: a time held from before it is dropped, and a read under way is stale. */
  seeking: () => void
  /** Reads where mpv is now, since the addon sends no trailing time-pos after a seek or a pause. */
  readNow: () => void
}

/**
 * The page's clock. The newest time handed to the page, sent or held, and a count of the seeks
 * sent, so a time read that answers late cannot step the clock back unless a seek moved it. One
 * read is in flight at a time; asks meanwhile become one read after it.
 */
export const createTimeReader = ({
  timers,
  show,
  read,
  epoch,
  isLoaded,
  onRead,
  warn,
}: CreateTimeReaderProps): TimeReader => {
  const throttle = createThrottle<number>({
    timers,
    ms: TIME_MS,
    show: (value) => {
      show(value)
      return true
    },
  })
  let shownTime: number | null = null
  let seeks = 0
  let isReading = false
  let isReadWanted = false

  const readNow = (): void => {
    if (isReading) {
      isReadWanted = true
      return
    }
    isReading = true
    const token = epoch()
    const seeksBefore = seeks
    const readOnce = async () => {
      const time = await read()
      if (token !== epoch() || time === null) return
      // A seek sent during the read makes it stale; that seek's playback-restart reads again.
      if (seeks !== seeksBefore) return
      if (shownTime !== null && time < shownTime) return
      onRead(time)
    }
    readOnce()
      .catch((error: unknown) => {
        warn(`player time read failed: ${messageOf(error)}`)
      })
      .finally(() => {
        isReading = false
        if (!isReadWanted) return
        isReadWanted = false
        if (isLoaded()) readNow()
      })
  }

  return {
    show: (time) => {
      shownTime = time
      throttle.push(time)
    },
    clear: () => {
      throttle.clear()
      shownTime = null
    },
    seeking: () => {
      throttle.drop()
      shownTime = null
      seeks += 1
    },
    readNow,
  }
}
