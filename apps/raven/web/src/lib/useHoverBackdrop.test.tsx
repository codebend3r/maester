import { describe, expect, it } from 'bun:test'
import { renderHook } from '@testing-library/react'
import { useHoverBackdrop, useOwnBackdrop } from '@/lib/useHoverBackdrop'
import { useHoverBackdrops } from '@/stores/hoverBackdrops'

describe('useHoverBackdrop', () => {
  it('gives a card with a picture its handlers', () => {
    const { result } = renderHook(() => useHoverBackdrop('/a.jpg'))
    expect(Object.keys(result.current).toSorted()).toEqual([
      'onBlur',
      'onFocus',
      'onPointerEnter',
      'onPointerLeave',
    ])
  })

  it('gives none on a page that keeps its own backdrop', () => {
    useHoverBackdrops.setState({ isOn: false })
    const { result } = renderHook(() => useHoverBackdrop('/a.jpg'))
    expect(result.current).toEqual({})
  })
})

describe('useOwnBackdrop', () => {
  it("turns the cards' pictures off while its page is up, and on again once it goes", () => {
    const { result, unmount } = renderHook(() => useOwnBackdrop())
    expect(result.current).toBe(true)
    expect(useHoverBackdrops.getState().isOn).toBe(false)
    unmount()
    expect(useHoverBackdrops.getState().isOn).toBe(true)
  })
})
