import { describe, expect, it } from 'bun:test'
import { MUSIC_PAGE, MUSIC_SORTS, musicListQuery } from '@/musicListQuery'

describe('musicListQuery', () => {
  it('writes only what differs from the defaults, and reads it back', () => {
    expect(musicListQuery.encode({})).toBe('sort=title')
    expect(
      musicListQuery.encode({ search: ' kid ', sort: MUSIC_SORTS.year, limit: 50, offset: 100 }),
    ).toBe('sort=year&limit=50&offset=100&q=kid')
    expect(musicListQuery.decode('sort=year&limit=50&offset=100&q=kid')).toEqual({
      search: 'kid',
      sort: MUSIC_SORTS.year,
      limit: 50,
      offset: 100,
    })
  })

  it('falls back on a page and an order it knows for anything else', () => {
    expect(musicListQuery.decode({ sort: 'loudness', limit: '-3', offset: 'x' })).toEqual({
      search: '',
      sort: MUSIC_SORTS.title,
      limit: MUSIC_PAGE.fallback,
      offset: 0,
    })
    expect(musicListQuery.decode({ limit: '99999' }).limit).toBe(MUSIC_PAGE.most)
    expect(musicListQuery.decode({ limit: '0' }).limit).toBe(MUSIC_PAGE.fallback)
  })
})
