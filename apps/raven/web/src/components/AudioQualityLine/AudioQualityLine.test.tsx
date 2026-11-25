import type { AudioQuality } from '@raven/core'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { AudioQualityLine } from '@/components/AudioQualityLine/AudioQualityLine'
import styles from '@/components/AudioQualityLine/AudioQualityLine.module.scss'

const FLAC: AudioQuality = {
  format: 'FLAC',
  bitDepth: '16-bit',
  sampleRate: '44.1 kHz',
  bitrate: '912 kbps',
  isDownloaded: false,
}

const AAC: AudioQuality = {
  format: 'AAC',
  bitDepth: null,
  sampleRate: null,
  bitrate: null,
  isDownloaded: false,
}

const PLACED = 'placed'

afterEach(cleanup)

describe('AudioQualityLine', () => {
  it('draws the format and the bit depth as chips, then the rest as words', () => {
    const { container } = render(<AudioQualityLine quality={FLAC} className={PLACED} />)
    const chips = Array.from(container.querySelectorAll(`.${styles.chips} > span`))
    expect(chips.map((chip) => chip.textContent)).toEqual(['FLAC', '16-bit'])
    expect(container.querySelector(`.${styles.rest}`)?.textContent).toBe('44.1 kHz · 912 kbps')
  })

  it('reads as one sentence, with what is drawn kept from a screen reader', () => {
    const { container } = render(<AudioQualityLine quality={FLAC} className={PLACED} />)
    expect(screen.getByText('Quality, FLAC, 16-bit, 44.1 kHz, 912 kbps')).toBeTruthy()
    expect(container.querySelector(`.${styles.chips}`)?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector(`.${styles.rest}`)?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says a download last', () => {
    const { container } = render(
      <AudioQualityLine quality={{ ...FLAC, isDownloaded: true }} className={PLACED} />,
    )
    expect(container.querySelector(`.${styles.rest}`)?.textContent).toBe(
      '44.1 kHz · 912 kbps · Downloaded',
    )
    expect(screen.getByText('Quality, FLAC, 16-bit, 44.1 kHz, 912 kbps, Downloaded')).toBeTruthy()
  })

  it('is the format alone when nothing else is known', () => {
    const { container } = render(<AudioQualityLine quality={AAC} className={PLACED} />)
    expect(container.querySelectorAll(`.${styles.chips} > span`)).toHaveLength(1)
    expect(container.querySelector(`.${styles.rest}`)).toBeNull()
    expect(screen.getByText('Quality, AAC')).toBeTruthy()
  })

  it('wears the class its container places it by', () => {
    const { container } = render(<AudioQualityLine quality={AAC} className={PLACED} />)
    expect(container.querySelector('p')?.className).toBe(`${styles.line} ${PLACED}`)
  })
})
