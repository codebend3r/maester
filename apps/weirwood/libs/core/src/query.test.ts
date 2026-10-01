import { describe, expect, it } from 'vitest'
import { fromQueryString, toQueryString } from './query.js'

describe('query strings', () => {
  it('encodes and decodes paths with spaces and ampersands', () => {
    const params = { path: '/media/Rock & Roll/Season 1', q: 'a+b' }
    expect(fromQueryString(toQueryString(params))).toEqual(params)
  })

  it('reads a leading question mark and plus-encoded spaces', () => {
    expect(fromQueryString('?q=the+matrix&sort=added')).toEqual({ q: 'the matrix', sort: 'added' })
  })
})
