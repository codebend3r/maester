import { describe, expect, it } from 'bun:test'
import { fillPath, fromQueryString, pathWithQuery, toQueryString } from '@/query'

describe('query strings', () => {
  it('encodes and decodes paths with spaces and ampersands', () => {
    const params = { path: '/media/Rock & Roll/Season 1', q: 'a+b' }
    expect(fromQueryString(toQueryString(params))).toEqual(params)
  })

  it('reads a leading question mark and plus-encoded spaces', () => {
    expect(fromQueryString('?q=the+matrix&sort=added')).toEqual({ q: 'the matrix', sort: 'added' })
  })
})

describe('paths', () => {
  it('fills each placeholder, escaped', () => {
    expect(
      fillPath({ path: '/api/pictures/:id/:version', params: { id: 7, version: 'a/b c' } }),
    ).toBe('/api/pictures/7/a%2Fb%20c')
  })

  it('adds a query only when there is one', () => {
    expect(pathWithQuery({ path: '/api/history', query: {} })).toBe('/api/history')
    expect(pathWithQuery({ path: '/api/history', query: { before: '9' } })).toBe(
      '/api/history?before=9',
    )
  })
})
