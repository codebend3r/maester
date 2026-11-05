import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { resolutionLabel } from '@raven/core'
import {
  FactText,
  PictureChip,
  PictureChips,
  PictureFact,
  RangeChip,
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

  it('marks the codec and the range of light with chips of their own', () => {
    const { container } = render(<FactText fact="4K (HEVC) HDR" />)
    expect(screen.getByLabelText('Video resolution: 4K')).toHaveClass(styles.uhd ?? '')
    expect(screen.getByLabelText('Video codec: HEVC')).toHaveClass(styles.hevc ?? '')
    expect(screen.getByLabelText('HDR')).toHaveClass(styles.hdr ?? '')
    expect(container.textContent).toBe('4K HEVC HDR')
  })

  it('leaves another codec on plain glass', () => {
    render(<FactText fact="1080p (H.264)" />)
    expect(screen.getByLabelText('Video codec: H.264')).toHaveAttribute('class', styles.chip)
  })

  it.each(['HDR10', 'HLG', 'Dolby Vision'])('colours %s as a range of light', (range) => {
    render(<PictureFact resolution="4K" rest={range} />)
    expect(screen.getByLabelText(range)).toHaveClass(styles.hdr ?? '')
  })

  it('keeps words that are no codec or range as words', () => {
    const { container } = render(<PictureFact resolution="4K" rest="SDR" />)
    expect(screen.queryByLabelText('SDR')).toBeNull()
    expect(container.textContent).toBe('4K SDR')
  })

  it('colours a bare range chip the same way', () => {
    render(<RangeChip range="HDR" />)
    expect(screen.getByLabelText('HDR')).toHaveClass(styles.hdr ?? '')
  })

  it('shows a picture with no resolution as its words alone', () => {
    const { container } = render(<PictureFact resolution={null} rest="HDR" />)
    expect(screen.queryByLabelText(/Video resolution/)).toBeNull()
    expect(container).toHaveTextContent('HDR')
  })

  it('warns of Dolby Vision profile 5 with a chip of its own, alone or after a resolution', () => {
    const { container } = render(
      <>
        <RangeChip range="DV5" />
        <PictureFact resolution="4K" rest="(HEVC) DV5" />
      </>,
    )
    const chips = screen.getAllByLabelText(
      'Dolby Vision profile 5: its colours come out wrong in a browser',
    )
    expect(chips).toHaveLength(2)
    chips.forEach((chip) => expect(chip).toHaveClass(styles.dolbyVisionOnly ?? ''))
    expect(container).toHaveTextContent('DV54K HEVC DV5')
  })

  it('marks a range of light alone as its chip, a word of a list or a fact', () => {
    render(
      <>
        <WordFact fact="HDR" />
        <FactText fact="DV5" />
      </>,
    )
    expect(screen.getByLabelText('HDR')).toHaveClass(styles.hdr ?? '')
    expect(
      screen.getByLabelText('Dolby Vision profile 5: its colours come out wrong in a browser'),
    ).toHaveTextContent('DV5')
  })

  it('marks a word of a list as a resolution only when it is one', () => {
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

  it('marks a video codec word of a list as its chip, HEVC in its own fill', () => {
    render(
      <>
        <WordFact fact="HEVC" />
        <WordFact fact="H.264" />
      </>,
    )
    expect(screen.getByLabelText('Video codec: HEVC')).toHaveClass(styles.hevc ?? '')
    expect(screen.getByLabelText('Video codec: H.264')).toHaveAttribute('class', styles.chip)
  })

  it("marks a codec alone as its chip, as a group's heading names it", () => {
    render(<FactText fact="HEVC" />)
    expect(screen.getByLabelText('Video codec: HEVC')).toHaveClass(styles.hevc ?? '')
  })

  it("draws a file's resolution, range and codec as chips, in that order", () => {
    const media = mediaItem({ width: 3840, height: 2160, hdr: true, isDolbyVisionOnly: true })
    const { container } = render(<PictureChips media={media} />)
    expect(screen.getByLabelText('Video resolution: 4K')).toHaveClass(styles.uhd ?? '')
    expect(
      screen.getByLabelText('Dolby Vision profile 5: its colours come out wrong in a browser'),
    ).toHaveClass(styles.dolbyVisionOnly ?? '')
    expect(screen.getByLabelText('Video codec: HEVC')).toHaveClass(styles.hevc ?? '')
    expect(container.textContent).toBe('4K DV5 HEVC')
  })

  it('draws nothing for a file not yet probed', () => {
    const media = mediaItem({ width: null, height: null, videoCodec: null, hdr: false })
    const { container } = render(<PictureChips media={media} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('leaves a fact with no resolution as plain text', () => {
    const { container } = render(<FactText fact="2h 58m" />)
    expect(container).toHaveTextContent('2h 58m')
    expect(container.querySelector('span')).toBeNull()
  })
})
