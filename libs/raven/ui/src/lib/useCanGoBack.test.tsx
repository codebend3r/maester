import { afterEach, describe, expect, it } from 'bun:test'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { useCanGoBack } from '@/lib/useCanGoBack'

type AtCallbackProps = { children: ReactNode }

const at =
  (index: number) =>
  ({ children }: AtCallbackProps) => (
    <MemoryRouter initialEntries={['/a', '/b']} initialIndex={index}>
      {children}
    </MemoryRouter>
  )

describe('useCanGoBack', () => {
  afterEach(() => window.history.replaceState(null, ''))

  it("is true when the browser router's history index is past the first entry", () => {
    window.history.replaceState({ idx: 1, key: 'k' }, '')
    expect(renderHook(() => useCanGoBack(), { wrapper: at(0) }).result.current).toBe(true)
  })

  it('is false on the first entry even when a replace gave it a key of its own', () => {
    window.history.replaceState({ idx: 0, key: 'k' }, '')
    expect(renderHook(() => useCanGoBack(), { wrapper: at(1) }).result.current).toBe(false)
  })

  it("falls back to the location's key when the browser has no index", () => {
    expect(renderHook(() => useCanGoBack(), { wrapper: at(1) }).result.current).toBe(true)
    type WrapperProps = { children: ReactNode }

    expect(
      renderHook(() => useCanGoBack(), {
        wrapper: ({ children }: WrapperProps) => <MemoryRouter>{children}</MemoryRouter>,
      }).result.current,
    ).toBe(false)
  })
})
