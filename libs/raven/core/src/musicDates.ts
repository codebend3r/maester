/** A release date at its actual precision, never filled with an invented month or day. */
export const releaseDateOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const date = value.trim()
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2] ?? 1)
  const day = Number(match[3] ?? 1)
  if (year < 1000 || month < 1 || month > 12 || day < 1) return null
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= lastDay ? date : null
}

type AlbumDateLabelProps = { releaseDate: string | null; year: number | null }

export const albumDateLabel = ({ releaseDate, year }: AlbumDateLabelProps): string | null => {
  if (releaseDate !== null) return formatReleaseDate(releaseDate)
  return year === null ? null : String(year)
}

/** UTC avoids shifting a calendar release date into the previous day. */
export const formatReleaseDate = (value: string): string => {
  if (value.length === 4) return value
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    ...(value.length === 10 ? ({ day: 'numeric' } as const) : {}),
    timeZone: 'UTC',
  }).format(new Date(`${value.padEnd(10, '-01')}T00:00:00Z`))
}
