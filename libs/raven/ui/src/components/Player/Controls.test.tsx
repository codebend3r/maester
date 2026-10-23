import { describe, expect, it, mock } from 'bun:test'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Controls, type ControlsProps } from '@/components/Player/Controls'

const props = (overrides: Partial<ControlsProps> = {}): ControlsProps => ({
  shown: true,
  paused: true,
  time: 2400,
  duration: 6120,
  buffered: [[0, 2700]],
  volume: 0.7,
  muted: false,
  fullscreen: false,
  subtitlesOn: true,
  menuOpen: false,
  settingsButton: createRef<HTMLButtonElement>(),
  upNext: 'Busboys 2 (2027)',
  countdown: null,
  endsAt: 'Ends at 2:20 AM',
  onRestart: () => {},
  onNext: () => {},
  onTogglePlay: () => {},
  onSeek: () => {},
  onSkip: () => {},
  onVolume: () => {},
  onToggleMute: () => {},
  onToggleMenu: () => {},
  onToggleFullscreen: () => {},
  ...overrides,
})

describe('Controls', () => {
  it('runs the transport in order: start, back, play, forward, next', () => {
    render(<Controls {...props()} />)
    const names = screen
      .getAllByRole('button')
      .slice(0, 5)
      .map((button) => button.getAttribute('aria-label'))
    expect(names).toEqual([
      'Back to the start (Home)',
      'Back 10 seconds (j)',
      'Play (k)',
      'Forward 10 seconds (l)',
      'Next: Busboys 2 (2027)',
    ])
  })

  it('goes back to the start and on to what is up next', async () => {
    const onRestart = mock(() => {})
    const onNext = mock(() => {})
    render(<Controls {...props({ onRestart, onNext })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Back to the start (Home)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next: Busboys 2 (2027)' }))
    expect(onRestart).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('keeps Next on the bar with nothing up next, unable to press', () => {
    render(<Controls {...props({ upNext: null })} />)
    expect(screen.getByRole('button', { name: 'Nothing up next' })).toBeDisabled()
  })

  it('shows the time played beside the timeline and the video’s length', () => {
    render(<Controls {...props()} />)
    expect(screen.getByText('40:00')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Length 1:42:00, show the end time' }),
    ).toHaveTextContent('1:42:00')
    expect(screen.queryByText('Ends at 2:20 AM')).toBeNull()
  })

  it('toggles between the length and when the video ends', async () => {
    render(<Controls {...props()} />)
    await userEvent.click(screen.getByRole('button', { name: /^Length 1:42:00/ }))
    expect(
      screen.getByRole('button', { name: 'Ends at 2:20 AM, show the length' }),
    ).toHaveTextContent('Ends at 2:20 AM')
    await userEvent.click(screen.getByRole('button', { name: /^Ends at 2:20 AM/ }))
    expect(screen.getByRole('button', { name: /^Length 1:42:00/ })).toBeInTheDocument()
  })

  it('shows neither while the length is unknown', () => {
    render(<Controls {...props({ duration: null, endsAt: null })} />)
    expect(screen.queryByRole('button', { name: /^Length/ })).toBeNull()
  })

  it('fills the ring only while the countdown runs', () => {
    const { container, rerender } = render(<Controls {...props()} />)
    expect(container.querySelector('[data-countdown]')).toBeNull()
    rerender(<Controls {...props({ countdown: 0.25 })} />)
    expect(container.querySelector('[data-countdown]')).toHaveAttribute('stroke-dashoffset', '0.75')
  })

  it('names each pill alone when the host says nothing of what it is set to', () => {
    render(<Controls {...props()} />)
    expect(screen.getByRole('button', { name: 'Subtitles: On' })).toHaveTextContent(
      'Subtitles · On',
    )
    expect(screen.getByRole('button', { name: 'Audio' })).toHaveTextContent(/^Audio$/)
    expect(screen.getByRole('button', { name: 'Playback' })).toHaveTextContent(/^Playback$/)
  })

  it('opens a pill’s menu, and lends the open pill the host’s button ref', async () => {
    const onToggleMenu = mock((_section: string) => {})
    const settingsButton = createRef<HTMLButtonElement>()
    render(
      <Controls
        {...props({
          menuOpen: 'audio',
          settingsButton,
          onToggleMenu,
          menuValues: { audio: 'English 5.1' },
        })}
      />,
    )
    const audio = screen.getByRole('button', { name: 'Audio: English 5.1' })
    expect(audio).toHaveAttribute('aria-expanded', 'true')
    expect(settingsButton.current).toHaveAttribute('aria-label', 'Audio: English 5.1')
    expect(screen.getByRole('button', { name: 'Subtitles: On' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Subtitles: On' }))
    expect(onToggleMenu).toHaveBeenCalledWith('subtitles')
  })

  it('offers the way out of full screen once in it', async () => {
    const onToggleFullscreen = mock(() => {})
    render(<Controls {...props({ fullscreen: true, onToggleFullscreen })} />)
    const pill = screen.getByRole('button', { name: 'Exit full screen (f)' })
    expect(pill).toHaveTextContent('Exit full screen')
    await userEvent.click(pill)
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
  })
})
