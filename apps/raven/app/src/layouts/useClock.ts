import { useEffect, useState } from 'react'

/** The time of day as the device says it: "9:41 PM", "21:41". */
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** How often the clock looks at the time; it re-renders only as the minute turns. */
const TICK_MS = 1000

const now = (): string => CLOCK.format(new Date())

/** The time of day, kept to the minute while the component is on screen. */
export const useClock = (): string => {
  const [time, setTime] = useState(now)
  useEffect(() => {
    const tick = setInterval(() => setTime(now()), TICK_MS)
    return () => clearInterval(tick)
  }, [])
  return time
}
