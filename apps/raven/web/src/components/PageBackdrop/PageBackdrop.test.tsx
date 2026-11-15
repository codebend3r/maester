import { describe, expect, it } from 'bun:test'
import { act, fireEvent, render } from '@testing-library/react'
import { PageBackdrop } from '@/components/PageBackdrop/PageBackdrop'
import { usePageBackdrop } from '@/stores/pageBackdrop'

describe('PageBackdrop', () => {
  it('fades a picture in once it has loaded, the one before it staying up till then', () => {
    const { container } = render(<PageBackdrop />)
    const shown = () =>
      [...container.querySelectorAll('img')]
        .filter((img) => img.className.includes('shown'))
        .map((img) => img.getAttribute('src'))
    act(() => usePageBackdrop.getState().show('/a'))
    expect(shown()).toEqual([])
    fireEvent.load(container.querySelector('img[src="/a"]') ?? document.body)
    expect(shown()).toEqual(['/a'])
    act(() => usePageBackdrop.getState().show('/b'))
    // Still loading: the picture before it stays up until it can cross fade.
    expect(shown()).toEqual(['/a'])
    fireEvent.load(container.querySelector('img[src="/b"]') ?? document.body)
    expect(shown()).toEqual(['/b'])
    expect(container.querySelectorAll('img')).toHaveLength(2)
  })

  it('fades away when nothing is pointed at', () => {
    const { container } = render(<PageBackdrop />)
    act(() => usePageBackdrop.getState().show('/a'))
    fireEvent.load(container.querySelector('img[src="/a"]') ?? document.body)
    act(() => usePageBackdrop.getState().hide('/a'))
    expect(container.querySelector('img[class*="shown"]')).toBeNull()
  })
})
