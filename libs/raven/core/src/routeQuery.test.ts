import { describe, expect, it } from 'bun:test'
import { ApiError, LOCKED_STATUS } from '@/apiClient'
import { routeIdOf, routeState } from '@/routeQuery'

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

describe('routeIdOf', () => {
  it('reads a whole number written in digits', () => {
    expect(routeIdOf('7')).toBe(7)
    expect(routeIdOf('0')).toBe(0)
    expect(routeIdOf('120')).toBe(120)
  })

  it('reads nothing else as an id', () => {
    expect(routeIdOf(undefined)).toBeNull()
    expect(routeIdOf('')).toBeNull()
    expect(routeIdOf(' 7')).toBeNull()
    expect(routeIdOf('7.5')).toBeNull()
    expect(routeIdOf('-1')).toBeNull()
    expect(routeIdOf('1e3')).toBeNull()
    expect(routeIdOf('0x10')).toBeNull()
    expect(routeIdOf('99999999999999999999')).toBeNull()
    expect(routeIdOf(['7'])).toBeNull()
    expect(routeIdOf(7)).toBeNull()
  })
})
