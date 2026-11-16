import { describe, expect, it } from 'bun:test'
import { TOUCH_HOLD_RATE } from '@raven/core'
import { render } from '@testing-library/react'
import { HoldMark } from '@/components/Player/Bezel'
import { PLAYER_ACTIONS_COPY } from '@/components/Player/copy'

describe('HoldMark', () => {
  it('shows the held speed on either side, hidden from assistive tech', () => {
    const { container, rerender } = render(<HoldMark side={1} />)
    const mark = container.firstElementChild
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
    expect(mark?.textContent).toBe(PLAYER_ACTIONS_COPY.rate(TOUCH_HOLD_RATE))
    rerender(<HoldMark side={-1} />)
    expect(container.firstElementChild?.textContent).toBe(PLAYER_ACTIONS_COPY.rate(TOUCH_HOLD_RATE))
  })
})
