const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

type DateParts = { year: number; month: number; day: number }

const partsOf = (date: string | null): DateParts | null => {
  const match = date == null ? null : DATE.exec(date)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

type AgeOnProps = {
  birthday: string | null
  on: string | null
}

/**
 * Whole years from `birthday` to `on`, both `YYYY-MM-DD`; null when either is
 * missing or malformed, or `on` comes before `birthday`. Read from the
 * strings, not a `Date`, so no time zone can move the day. A Feb 29 birthday
 * comes on Mar 1 in a year without one.
 */
export const ageOn = ({ birthday, on }: AgeOnProps): number | null => {
  const born = partsOf(birthday)
  const now = partsOf(on)
  if (!born || !now) return null
  const hasHadBirthday = now.month > born.month || (now.month === born.month && now.day >= born.day)
  const age = now.year - born.year - (hasHadBirthday ? 0 : 1)
  return age < 0 ? null : age
}
