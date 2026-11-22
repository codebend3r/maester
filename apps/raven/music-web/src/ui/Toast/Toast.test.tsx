import { describe, expect, it } from 'bun:test'
import { act, screen } from '@testing-library/react'
import { useToast } from '@/stores/toast'
import { renderKitWithRoutes } from '@/test/render'
import { ToastHost } from '@/ui/Toast/Toast'

describe('ToastHost', () => {
  it('raises the toast a screen shows, said aloud, and takes it down when it hides', () => {
    renderKitWithRoutes(<ToastHost />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    act(() => useToast.getState().show('Added to Mixtape'))
    expect(screen.getByRole('status')).toHaveTextContent('Added to Mixtape')

    act(() => useToast.getState().hide())
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
