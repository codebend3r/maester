import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NOTIFICATION_TONES } from '@raven/core'
import { Toaster } from '@/components/Toaster/Toaster'
import { TOAST_FADE_MS, TOAST_MS, useToasts } from '@/stores/toasts'

const show = (message: string) => act(() => useToasts.getState().show(message))

describe('Toaster', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('reads each toast out as it comes, in order', () => {
    render(<Toaster />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    show('Error reported.')
    show('Saved.')
    expect(screen.getByRole('status')).toHaveTextContent('Error reported.Saved.')
  })

  it('takes a toast away when it is dismissed', () => {
    render(<Toaster />)
    show('Error reported.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Error reported.')).toBeNull()
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('fades a toast out over the end of its time, then takes it away', () => {
    render(<Toaster />)
    show('Error reported.')
    const toast = () => screen.getByText('Error reported.').parentElement
    act(() => jest.advanceTimersByTime(TOAST_MS - TOAST_FADE_MS - 1))
    expect(toast()?.className ?? '').not.toContain('leaving')
    act(() => jest.advanceTimersByTime(1))
    expect(toast()?.className ?? '').toContain('leaving')
    act(() => jest.advanceTimersByTime(TOAST_FADE_MS))
    expect(screen.queryByText('Error reported.')).toBeNull()
  })

  it('stacks toasts and lets each go on its own clock', () => {
    render(<Toaster />)
    show('Error reported.')
    act(() => jest.advanceTimersByTime(TOAST_MS / 2))
    show('Saved.')
    act(() => jest.advanceTimersByTime(TOAST_MS / 2))
    expect(screen.queryByText('Error reported.')).toBeNull()
    expect(screen.getByText('Saved.')).toBeInTheDocument()
    act(() => jest.advanceTimersByTime(TOAST_MS / 2))
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('takes each toast away by itself after a few seconds', () => {
    render(<Toaster />)
    show('Error reported.')
    act(() => jest.advanceTimersByTime(TOAST_MS - 1))
    expect(screen.getByText('Error reported.')).toBeInTheDocument()
    act(() => jest.advanceTimersByTime(1))
    expect(screen.queryByText('Error reported.')).toBeNull()
  })
})

describe('the toast store', () => {
  it('gives every toast its own id, so two alike both show', () => {
    useToasts.getState().show('Saved.')
    useToasts.getState().show('Saved.')
    const [first, second] = useToasts.getState().toasts
    expect(first?.id ?? -1).not.toBe(second?.id ?? -2)
    useToasts.getState().dismiss(first?.id ?? -1)
    expect(useToasts.getState().toasts).toEqual([
      {
        id: second?.id ?? -1,
        message: 'Saved.',
        tone: NOTIFICATION_TONES.success,
        isLogged: false,
      },
    ])
  })

  it('shows a notification the server sent as logged already, in its own tone', () => {
    useToasts.getState().showNotification({
      id: 7,
      message: 'Smart match stopped: MusicBrainz is down',
      tone: NOTIFICATION_TONES.failure,
      at: '2026-11-08T12:00:00.000Z',
    })
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({
      message: 'Smart match stopped: MusicBrainz is down',
      tone: NOTIFICATION_TONES.failure,
      isLogged: true,
    })
  })
})

describe('the toast tones', () => {
  it('marks a failure apart from a confirmation', () => {
    render(<Toaster />)
    act(() =>
      useToasts.getState().showNotification({
        id: 8,
        message: 'Smart match stopped.',
        tone: NOTIFICATION_TONES.failure,
        at: '2026-11-08T12:00:00.000Z',
      }),
    )
    show('Saved.')
    const toastOf = (text: string) => screen.getByText(text).parentElement?.className ?? ''
    expect(toastOf('Smart match stopped.')).toContain('failure')
    expect(toastOf('Saved.')).toContain('success')
  })
})
