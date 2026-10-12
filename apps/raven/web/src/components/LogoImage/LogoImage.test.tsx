import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { LogoImage } from '@/components/LogoImage/LogoImage'
import * as logoTone from '@/lib/logoTone'

describe('LogoImage', () => {
  const tone = spyOn(logoTone, 'isDarkLogo')

  afterEach(() => tone.mockReset())
  afterAll(() => tone.mockRestore())

  it("draws a dark logo in white once it has loaded, beside the caller's own class", () => {
    tone.mockImplementation(() => true)
    render(<LogoImage src="/logo.png" alt="Heat" className="sized" />)
    const logo = screen.getByRole('img', { name: 'Heat' })
    expect(logo).toHaveClass('sized')
    expect(logo).not.toHaveClass('whitened')
    fireEvent.load(logo)
    expect(logo).toHaveClass('sized', 'whitened')
  })

  it('leaves a light logo as it is', () => {
    tone.mockImplementation(() => false)
    render(<LogoImage src="/logo.png" alt="Heat" />)
    fireEvent.load(screen.getByRole('img', { name: 'Heat' }))
    expect(screen.getByRole('img', { name: 'Heat' })).not.toHaveClass('whitened')
  })
})
