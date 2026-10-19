import { describe, expect, it } from 'bun:test'
import { ApiError, LOCKED_STATUS } from '@raven/core'
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

  it('is missing when the server answers 404, even over data read before', () => {
    const error = new ApiError({ status: 404, message: 'Not found' })
    expect(routeState({ id: 1, query: { data: 'x', error } })).toEqual({ state: 'missing' })
  })

  it('carries any other failure of a first read', () => {
    const error = new ApiError({ status: 500, message: 'Broken' })
    expect(routeState({ id: 1, query: { data: undefined, error } })).toEqual({
      state: 'error',
      message: 'Broken',
    })
    expect(routeState({ id: 1, query: { data: undefined, error: new Error('Offline') } })).toEqual({
      state: 'error',
      message: 'Offline',
    })
  })

  it('keeps data read before through a failed read behind it', () => {
    const error = new ApiError({ status: 500, message: 'Broken' })
    expect(routeState({ id: 1, query: { data: 'x', error } })).toEqual({
      state: 'ready',
      data: 'x',
    })
    expect(routeState({ id: 1, query: { data: 'x', error: new Error('Offline') } })).toEqual({
      state: 'ready',
      data: 'x',
    })
  })

  it('takes data read before down once its library is locked', () => {
    const error = new ApiError({ status: LOCKED_STATUS, message: 'Locked' })
    expect(routeState({ id: 1, query: { data: 'x', error } })).toEqual({
      state: 'error',
      message: 'Locked',
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
