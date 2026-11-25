import { beforeEach, describe, expect, it } from 'bun:test'
import { usePlayerPrefs } from '@raven/ui/headless'
import { NOW_PLAYING_COPY, PLAYER_COPY } from '@raven/wren'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Volume } from '@/player/Volume/Volume'

const line = () => screen.getByRole('slider', { name: PLAYER_COPY.volume })

describe('Volume', () => {
  beforeEach(() => {
    usePlayerPrefs.getState().setVolume({ volume: 0.5, muted: false })
  })

  it('mutes from its speaker, which keeps the level and stands the line at silent', async () => {
    render(<Volume />)

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.mute }))

    expect(usePlayerPrefs.getState().muted).toBe(true)
    expect(usePlayerPrefs.getState().volume).toBe(0.5)
    expect(line()).toHaveValue('0')
    expect(line()).toHaveAttribute('aria-valuetext', NOW_PLAYING_COPY.percent(0))
  })

  it('unmutes from its speaker, back at the level it had', async () => {
    usePlayerPrefs.getState().setVolume({ volume: 0.5, muted: true })
    render(<Volume />)

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.unmute }))

    expect(usePlayerPrefs.getState().muted).toBe(false)
    expect(line()).toHaveValue('0.5')
  })

  it('unmutes when its line is moved', () => {
    usePlayerPrefs.getState().setVolume({ volume: 0.5, muted: true })
    render(<Volume />)

    fireEvent.change(line(), { target: { value: '0.8' } })

    expect(usePlayerPrefs.getState().volume).toBe(0.8)
    expect(usePlayerPrefs.getState().muted).toBe(false)
  })
})
