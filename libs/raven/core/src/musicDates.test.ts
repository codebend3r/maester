import { describe, expect, it } from 'bun:test'
import { albumDateLabel, formatReleaseDate, releaseDateOf } from '@/musicDates'

describe('music release dates', () => {
  it('keeps the actual precision and rejects invalid calendar dates', () => {
    expect(releaseDateOf(' 1997-05-21 ')).toBe('1997-05-21')
    expect(releaseDateOf('1997-05')).toBe('1997-05')
    expect(releaseDateOf('1997')).toBe('1997')
    expect(releaseDateOf('2024-02-29')).toBe('2024-02-29')
    ;['2023-02-29', '1997-13', '1997-04-31', 'unknown', '', '1997-00-01'].forEach((date) =>
      expect(releaseDateOf(date)).toBeNull(),
    )
    expect(releaseDateOf(null)).toBeNull()
  })

  it('formats dates without inventing a day or shifting time zones', () => {
    expect(formatReleaseDate('1997-05-21')).toBe('May 21, 1997')
    expect(formatReleaseDate('1997-05')).toBe('May 1997')
    expect(formatReleaseDate('1997')).toBe('1997')
    expect(albumDateLabel({ releaseDate: null, year: 1997 })).toBe('1997')
    expect(albumDateLabel({ releaseDate: null, year: null })).toBeNull()
  })
})
