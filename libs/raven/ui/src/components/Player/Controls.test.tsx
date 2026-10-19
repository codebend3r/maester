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
  autoplay: true,
  countdown: null,
  onToggleAutoplay: () => {},
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
  it('switches autoplay beside the skips, saying what plays next', async () => {
    const onToggleAutoplay = mock(() => {})
    render(<Controls {...props({ onToggleAutoplay })} />)
    const autoplay = screen.getByRole('button', { name: 'Autoplay', pressed: true })
    expect(autoplay).toHaveAttribute('title', 'Busboys 2 (2027) plays next')
    await userEvent.click(autoplay)
    expect(onToggleAutoplay).toHaveBeenCalledTimes(1)
  })

  it('says what waits with autoplay off', () => {
    render(<Controls {...props({ autoplay: false })} />)
    expect(screen.getByRole('button', { name: 'Autoplay', pressed: false })).toHaveAttribute(
      'title',
      'Busboys 2 (2027) waits for you to play it',
    )
  })

  it('keeps autoplay on the bar with nothing up next, unable to press', () => {
    render(<Controls {...props({ upNext: null })} />)
    const autoplay = screen.getByRole('button', { name: 'Autoplay' })
    expect(autoplay).toBeDisabled()
    expect(autoplay).toHaveAttribute('title', 'Nothing is up next')
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
    expect(screen.getByText('40:00')).toBeInTheDocument()
    expect(screen.getByText('/ 1:42:00')).toBeInTheDocument()
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
