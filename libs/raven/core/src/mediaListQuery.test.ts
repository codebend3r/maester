import { describe, expect, it } from 'vitest'
import { mediaListQuery } from '@/mediaListQuery'

describe('mediaListQuery', () => {
  it('writes the search trimmed, and the seed only with a random sort', () => {
    expect(mediaListQuery.encode({ search: ' matrix ' })).toBe('sort=title&q=matrix')
    expect(mediaListQuery.encode({ sort: 'random', seed: 42 })).toBe('sort=random&seed=42')
    expect(mediaListQuery.encode({ sort: 'added', seed: 42 })).toBe('sort=added')
  })

  it('reads back what it writes', () => {
    expect(
      mediaListQuery.decode(mediaListQuery.encode({ sort: 'random', seed: 7, search: 'heat' })),
    ).toEqual({
      search: 'heat',
      sort: 'random',
      seed: 7,
    })
  })

  it('fills in what the query leaves out or gets wrong', () => {
    expect(mediaListQuery.decode({})).toEqual({ search: '', sort: 'title', seed: 0 })
    expect(mediaListQuery.decode({ q: 'heat', sort: 'loudest', seed: 'x' })).toEqual({
      search: 'heat',
      sort: 'title',
      seed: 0,
    })
  })
})
