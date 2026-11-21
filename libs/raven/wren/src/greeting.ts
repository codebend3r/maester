import { HOME_COPY } from '@/copy/screens'

/** Where the afternoon and the evening start, in hours of the day. */
const HOURS = { afternoon: 12, evening: 18 } as const

/** Home's large title for an hour of the day, 0 to 23: Good morning, afternoon or evening. */
export const greetingOf = (hour: number): string => {
  if (hour < HOURS.afternoon) return HOME_COPY.greeting.morning
  if (hour < HOURS.evening) return HOME_COPY.greeting.afternoon
  return HOME_COPY.greeting.evening
}
