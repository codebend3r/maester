import { describe, expect, it, mock, spyOn } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { Scrubber } from '@/components/Player/Scrubber'

describe('Scrubber', () => {
  it('previews pointer dragging, clamps it, and seeks only on release', () => {
    const seek = mock(() => {})
    render(<Scrubber time={10} duration={100} buffered={[[0, 40]]} onSeek={seek} />)
    const slider = screen.getByRole('slider')
    const rect = spyOn(slider, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 0, 100, 10))
    try {
      fireEvent.pointerMove(slider, { clientX: 60 })
      expect(screen.getByText('0:50')).toBeInTheDocument()
      fireEvent.pointerDown(slider, { button: 0, clientX: 60 })
      expect(slider).toHaveAttribute('aria-valuenow', '50')
      fireEvent.pointerMove(slider, { clientX: 200 })
      expect(slider).toHaveAttribute('aria-valuenow', '100')
      expect(seek).not.toHaveBeenCalled()
      fireEvent.pointerUp(slider, { clientX: 85 })
      expect(seek).toHaveBeenCalledWith(75)
      fireEvent.pointerLeave(slider)
      expect(slider).toHaveAttribute('aria-valuenow', '10')
      fireEvent.pointerDown(slider, { button: 0, clientX: -20 })
      expect(slider).toHaveAttribute('aria-valuenow', '0')
      fireEvent.pointerCancel(slider)
      expect(slider).toHaveAttribute('aria-valuenow', '10')
      fireEvent.pointerUp(slider, { clientX: 40 })
      expect(seek).toHaveBeenCalledTimes(1)
    } finally {
      rect.mockRestore()
    }
  })

  it('does not seek without a duration or on a secondary button', () => {
    const seek = mock(() => {})
    const { rerender } = render(<Scrubber time={0} duration={null} buffered={[]} onSeek={seek} />)
    const slider = screen.getByRole('slider')
    fireEvent.pointerDown(slider, { button: 0, clientX: 10 })
    fireEvent.pointerMove(slider, { clientX: 10 })
    fireEvent.pointerUp(slider, { clientX: 10 })
    rerender(<Scrubber time={0} duration={100} buffered={[]} onSeek={seek} />)
    fireEvent.pointerDown(slider, { button: 1, clientX: 10 })
    fireEvent.pointerUp(slider, { clientX: 10 })
    expect(seek).not.toHaveBeenCalled()
  })
})
