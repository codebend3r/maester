import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { PictureChip, ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import { mediaItem } from '@/test/fixtures'

describe('ResolutionChip', () => {
  it("names a video's resolution", () => {
    render(<ResolutionChip media={mediaItem()} />)
    expect(screen.getByLabelText('Video resolution: 1080p')).toHaveTextContent('1080p')
  })

  it('labels any other short fact over a picture the same way', () => {
    render(<PictureChip label="HDR">HDR</PictureChip>)
    expect(screen.getByLabelText('HDR')).toHaveTextContent('HDR')
  })

  it('shows nothing before the video has been probed', () => {
    const { container } = render(
      <ResolutionChip media={mediaItem({ width: null, height: null })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
