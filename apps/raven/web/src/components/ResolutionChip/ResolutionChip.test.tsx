import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { resolutionLabel } from '@raven/core'
import {
  FactText,
  PictureChip,
  PictureFact,
  ResolutionChip,
  WordFact,
} from '@/components/ResolutionChip/ResolutionChip'
import styles from '@/components/ResolutionChip/ResolutionChip.module.scss'
import { mediaItem } from '@/test/fixtures'

describe('ResolutionChip', () => {
  it("names a video's resolution", () => {
    render(<ResolutionChip resolution={resolutionLabel(mediaItem())} />)
    expect(screen.getByLabelText('Video resolution: 1080p')).toHaveTextContent('1080p')
  })

  it.each([
    [{ width: 480, height: 320 }, '320p', 'p320'],
    [{ width: 854, height: 480 }, '480p', 'p480'],
    [{ width: 1280, height: 720 }, '720p', 'hd'],
    [{ width: 1920, height: 1080 }, '1080p', 'fullHd'],
    [{ width: 3840, height: 2160 }, '4K', 'uhd'],
    [{ width: 7680, height: 4320 }, '8K', 'uhd8k'],
  ] as const)('colours %j as %s by its tier', (size, resolution, tier) => {
    render(<ResolutionChip resolution={resolutionLabel(size)} />)
    expect(screen.getByLabelText(`Video resolution: ${resolution}`)).toHaveClass(styles[tier] ?? '')
  })

  it('leaves SD on plain glass', () => {
    render(<ResolutionChip resolution="SD" />)
    expect(screen.getByLabelText('Video resolution: SD')).toHaveAttribute('class', styles.chip)
  })

  it('labels any other short fact over a picture the same way', () => {
    render(<PictureChip label="HDR">HDR</PictureChip>)
    expect(screen.getByLabelText('HDR')).toHaveTextContent('HDR')
  })

  it('shows nothing before the video has been probed', () => {
    const { container } = render(<ResolutionChip resolution={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('marks a fact led by a resolution with its chip, the rest beside it', () => {
    const { container } = render(<FactText fact="4K HDR" />)
    expect(screen.getByLabelText('Video resolution: 4K')).toHaveClass(styles.uhd ?? '')
    // A copy or a search still reads the words, space and all.
    expect(container.textContent).toBe('4K HDR')
  })

  it('shows a picture with no resolution as its words alone', () => {
    const { container } = render(<PictureFact resolution={null} rest="HDR" />)
    expect(screen.queryByLabelText(/Video resolution/)).toBeNull()
    expect(container).toHaveTextContent('HDR')
  })

  it('marks a word of a list only when it is a resolution', () => {
    const { container } = render(
      <>
        <WordFact fact="720p" />
        <WordFact fact="4K Movies" />
      </>,
    )
    expect(screen.getByLabelText('Video resolution: 720p')).toHaveClass(styles.hd ?? '')
    expect(container).toHaveTextContent('720p4K Movies')
    expect(screen.queryByLabelText('Video resolution: 4K')).toBeNull()
  })

  it('leaves a fact with no resolution as plain text', () => {
    const { container } = render(<FactText fact="2h 58m" />)
    expect(container).toHaveTextContent('2h 58m')
    expect(container.querySelector('span')).toBeNull()
  })
})
