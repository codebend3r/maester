import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Toaster } from '@/components/Toaster/Toaster'
import { TOAST_MS, useToasts } from '@/stores/toasts'

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
    expect(useToasts.getState().toasts).toEqual([{ id: second?.id ?? -1, message: 'Saved.' }])
  })
})
