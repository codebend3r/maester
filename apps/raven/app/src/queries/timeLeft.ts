const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

/** How a resume card says how much is left to watch. */
const TIME_LEFT_COPY = {
  left: (time: string) => `${time} left`,
  underMinute: 'Under 1m left',
  hours: (hours: number) => `${hours}h`,
  minutes: (minutes: number) => `${minutes}m`,
  hoursAndMinutes: ({ hours, minutes }: { hours: number; minutes: number }) =>
    `${hours}h ${minutes}m`,
} as const

type TimeLeftOfProps = { duration: number | null; position: number }

/**
 * What is left of a video as "42m left" or "1h 5m left", rounded up to the minute, "Under 1m
 * left" for the last seconds; null when its length is not known or nothing is left.
 */
export const timeLeftOf = ({ duration, position }: TimeLeftOfProps): string | null => {
  if (duration === null) return null
  const seconds = duration - position
  if (seconds <= 0) return null
  if (seconds < SECONDS_PER_MINUTE) return TIME_LEFT_COPY.underMinute
  const total = Math.ceil(seconds / SECONDS_PER_MINUTE)
  const hours = Math.floor(total / MINUTES_PER_HOUR)
  const minutes = total % MINUTES_PER_HOUR
  if (hours === 0) return TIME_LEFT_COPY.left(TIME_LEFT_COPY.minutes(minutes))
  if (minutes === 0) return TIME_LEFT_COPY.left(TIME_LEFT_COPY.hours(hours))
  return TIME_LEFT_COPY.left(TIME_LEFT_COPY.hoursAndMinutes({ hours, minutes }))
}
