import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { PictureChip, ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import styles from '@/components/ResolutionChip/ResolutionChip.module.scss'
import { mediaItem } from '@/test/fixtures'

describe('ResolutionChip', () => {
  it("names a video's resolution", () => {
    render(<ResolutionChip media={mediaItem()} />)
    expect(screen.getByLabelText('Video resolution: 1080p')).toHaveTextContent('1080p')
  })

  it.each([
    [{ width: 1280, height: 720 }, '720p', 'hd'],
    [{ width: 1920, height: 1080 }, '1080p', 'fullHd'],
    [{ width: 3840, height: 2160 }, '4K', 'uhd'],
    [{ width: 7680, height: 4320 }, '8K', 'uhd8k'],
  ] as const)('colours %j as %s by its tier', (size, resolution, tier) => {
    render(<ResolutionChip media={mediaItem(size)} />)
    expect(screen.getByLabelText(`Video resolution: ${resolution}`)).toHaveClass(styles[tier] ?? '')
  })

  it('leaves SD on plain glass', () => {
    render(<ResolutionChip media={mediaItem({ width: 640, height: 360 })} />)
    expect(screen.getByLabelText('Video resolution: SD')).toHaveAttribute('class', styles.chip)
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
