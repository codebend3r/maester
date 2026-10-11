import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { PartlyWatched, ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { mediaItem } from '@/test/fixtures'

describe('ResumeBar', () => {
  it('draws nothing for a video not yet started', () => {
    const { container } = render(<ResumeBar media={mediaItem({ position: 0 })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('fills as far as playback got', () => {
    const { container } = render(<ResumeBar media={mediaItem({ position: 30, duration: 120 })} />)
    expect(container.querySelector('[style]')).toHaveStyle({ width: '25%' })
  })
})

describe('PartlyWatched', () => {
  it("says so only for a video that's partway", () => {
    render(<PartlyWatched media={mediaItem({ position: 30, duration: 120 })} />)
    expect(screen.getByText('Partly watched')).toBeInTheDocument()
  })
})
