import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LogoImage } from '@/components/LogoImage/LogoImage'
import * as logoTone from '@/lib/logoTone'
import { useTheme } from '@/stores/theme'

describe('LogoImage', () => {
  const tone = spyOn(logoTone, 'logoTone')

  afterEach(() => {
    cleanup()
    tone.mockReset()
  })
  afterAll(() => tone.mockRestore())

  const loaded = () => {
    const logo = screen.getByRole('img', { name: 'Heat' })
    fireEvent.load(logo)
    return logo
  }

  it("draws a dark logo in white on a dark theme once it has loaded, beside the caller's own class", () => {
    tone.mockImplementation(() => 'dark')
    render(<LogoImage src="/logo.png" alt="Heat" className="sized" />)
    expect(screen.getByRole('img', { name: 'Heat' })).not.toHaveClass('whitened')
    expect(loaded()).toHaveClass('sized', 'whitened')
  })

  it('draws a light logo in ink on a light theme, and leaves a dark one be there', () => {
    act(() => useTheme.setState({ theme: 'patina' }))
    tone.mockImplementation(() => 'light')
    render(<LogoImage src="/logo.png" alt="Heat" />)
    expect(loaded()).toHaveClass('inked')
    cleanup()
    tone.mockImplementation(() => 'dark')
    render(<LogoImage src="/logo.png" alt="Heat" />)
    expect(loaded()).not.toHaveClass('whitened')
  })

  it('leaves a light logo as it is on a dark theme, and a logo in colours on any', () => {
    tone.mockImplementation(() => 'light')
    render(<LogoImage src="/logo.png" alt="Heat" />)
    expect(loaded()).not.toHaveClass('inked')
    cleanup()
    tone.mockImplementation(() => 'mixed')
    act(() => useTheme.setState({ theme: 'mint' }))
    render(<LogoImage src="/logo.png" alt="Heat" />)
    expect(loaded().className).toBe('')
  })
})
