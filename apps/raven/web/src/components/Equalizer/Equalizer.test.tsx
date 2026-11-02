import { describe, expect, it } from 'bun:test'
import { render } from '@testing-library/react'
import { Equalizer } from '@/components/Equalizer/Equalizer'
import styles from '@/components/Equalizer/Equalizer.module.scss'

describe('Equalizer', () => {
  it('moves while playing and holds still when paused', () => {
    const { container, rerender } = render(<Equalizer isPlaying />)
    expect(container.querySelector(`.${styles.still}`)).toBeNull()
    rerender(<Equalizer isPlaying={false} />)
    expect(container.querySelector(`.${styles.still}`)).not.toBeNull()
  })
})
