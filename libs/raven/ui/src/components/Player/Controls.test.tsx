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
