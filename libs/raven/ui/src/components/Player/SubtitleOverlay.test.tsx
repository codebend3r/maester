import { describe, expect, it } from 'bun:test'
import { CAPTION_COLOURS, CAPTION_SIZES, type CaptionStyle } from '@raven/core'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { SubtitleOverlay } from '@/components/Player/SubtitleOverlay'
import styles from '@/components/Player/SubtitleOverlay.module.scss'

const CUES = [{ start: 0, end: 5, text: '<b>Hold</b> <i>the</i> door' }]

const renderOverlay = (captionStyle: CaptionStyle) =>
  render(
    <SubtitleOverlay
      cues={CUES}
      video={createRef<HTMLVideoElement>()}
      shift={0}
      lifted={false}
      captionStyle={captionStyle}
    />,
  )

describe('SubtitleOverlay', () => {
  it("hands the stylesheet the account's size and colour", () => {
    const { container, rerender } = renderOverlay({
      size: CAPTION_SIZES.large,
      colour: CAPTION_COLOURS.yellow,
    })
    const overlay = container.querySelector<HTMLElement>(`.${styles.overlay}`)
    expect(overlay?.style.getPropertyValue('--caption-scale')).toBe('1.3')
    expect(overlay?.style.getPropertyValue('--caption-colour')).toBe('#ffe14d')
    rerender(
      <SubtitleOverlay
        cues={CUES}
        video={createRef<HTMLVideoElement>()}
        shift={0}
        lifted={false}
        captionStyle={{ size: CAPTION_SIZES.small, colour: CAPTION_COLOURS.green }}
      />,
    )
    expect(overlay?.style.getPropertyValue('--caption-scale')).toBe('0.8')
    expect(overlay?.style.getPropertyValue('--caption-colour')).toBe('#7dff8a')
  })

  it('keeps italics and draws a bold run at the one weight the face has', () => {
    renderOverlay({ size: CAPTION_SIZES.medium, colour: CAPTION_COLOURS.white })
    expect(screen.getByText('the')).toHaveClass(styles.italic ?? '')
    expect(screen.getByText('Hold').className).toBe('')
  })
})
