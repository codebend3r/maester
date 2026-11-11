import { useEffect, useState } from 'react'

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** The part of a formatted time that says morning or afternoon. */
const DAY_PERIOD = 'dayPeriod' satisfies Intl.DateTimeFormatPartTypes

/** A space no line breaks at. */
const NO_BREAK_SPACE = '\u00A0'

/**
 * The time of day from a formatter's parts: "9:41 PM", "9:41 pm", "21:41". A locale that
 * writes "p.m." loses its full stops, so the widest time is as narrow as it can be, and its
 * space never breaks, so the time is never set on two lines.
 */
export const clockTextOf = (parts: readonly Intl.DateTimeFormatPart[]): string =>
  parts
    .map(({ type, value }) => (type === DAY_PERIOD ? value.replaceAll('.', '') : value))
    .join('')
    .replace(/\s/g, NO_BREAK_SPACE)

/** How often the clock looks at the time; it re-renders only as the minute turns. */
const TICK_MS = 1000

const now = (): string => clockTextOf(CLOCK.formatToParts(new Date()))

/** The time of day, kept to the minute while the component is on screen. */
export const useClock = (): string => {
  const [time, setTime] = useState(now)
  useEffect(() => {
    const tick = setInterval(() => setTime(now()), TICK_MS)
    return () => clearInterval(tick)
  }, [])
  return time
}
