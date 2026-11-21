import { afterEach, describe, expect, it, jest } from 'bun:test'
import { TOAST_MS } from '@raven/wren'
import { toastFailure, useToast } from '@/stores/toast'

describe('useToast', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows a message, then hides it after a couple of seconds', () => {
    jest.useFakeTimers()
    useToast.getState().show('Added to Mixtape')
    expect(useToast.getState().message).toBe('Added to Mixtape')

    jest.advanceTimersByTime(TOAST_MS - 1)
    expect(useToast.getState().message).toBe('Added to Mixtape')
    jest.advanceTimersByTime(1)
    expect(useToast.getState().message).toBeNull()
  })

  it('shows a new message in place of the one showing, for its own full time', () => {
    jest.useFakeTimers()
    useToast.getState().show('Created Road trip')
    jest.advanceTimersByTime(TOAST_MS - 100)
    useToast.getState().show('Added to Road trip')
    jest.advanceTimersByTime(TOAST_MS - 100)

    expect(useToast.getState().message).toBe('Added to Road trip')
  })

  it('hides at once when told to', () => {
    useToast.getState().show('Added to Mixtape')
    useToast.getState().hide()
    expect(useToast.getState().message).toBeNull()
  })

  it("says a failure in the error's own words", () => {
    toastFailure(new Error('The playlist is full'))
    expect(useToast.getState().message).toBe('The playlist is full')
  })
})
