import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'

describe('WatchedToggle', () => {
  it.each([
    ['unwatched', 'false'],
    ['partly', 'mixed'],
    ['watched', 'true'],
  ] as const)('reads %s as aria-pressed %s', (state, pressed) => {
    render(<WatchedToggle state={state} onToggle={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Watched' })).toHaveAttribute('aria-pressed', pressed)
  })

  it('asks to toggle when pressed', async () => {
    let presses = 0
    render(<WatchedToggle state="unwatched" onToggle={() => (presses += 1)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Watched' }))
    expect(presses).toBe(1)
  })

  it('is only its check, named for a screen reader, when the label is not shown', () => {
    render(
      <WatchedToggle
        state="watched"
        onToggle={() => undefined}
        label="Watched Pilot"
        isLabelShown={false}
      />,
    )
    const button = screen.getByRole('button', { name: 'Watched Pilot' })
    expect(button).toHaveTextContent('')
  })
})
