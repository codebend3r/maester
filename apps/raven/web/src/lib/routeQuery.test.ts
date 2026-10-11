import { describe, expect, it } from 'bun:test'
import { ApiError } from '@raven/core'
import { routeState } from '@/lib/routeQuery'

describe('routeState', () => {
  it('is missing without an id', () => {
    expect(routeState({ id: null, query: { data: 'x', error: null } })).toEqual({
      state: 'missing',
    })
  })

  it('is missing when the server answers 404', () => {
    const error = new ApiError({ status: 404, message: 'Not found' })
    expect(routeState({ id: 1, query: { data: undefined, error } })).toEqual({ state: 'missing' })
  })

  it('carries any other failure, even over data read before', () => {
    const error = new ApiError({ status: 500, message: 'Broken' })
    expect(routeState({ id: 1, query: { data: 'x', error } })).toEqual({
      state: 'error',
      message: 'Broken',
    })
  })

  it('is loading until the data arrives, then ready', () => {
    expect(routeState({ id: 1, query: { data: undefined, error: null } })).toEqual({
      state: 'loading',
    })
    expect(routeState({ id: 1, query: { data: 'x', error: null } })).toEqual({
      state: 'ready',
      data: 'x',
    })
  })
})
