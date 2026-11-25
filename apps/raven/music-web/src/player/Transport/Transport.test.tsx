import { describe, expect, it } from 'bun:test'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, TRANSPORTS } from '@raven/wren'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Transport } from '@/player/Transport/Transport'
import { AIRBAG, LUCKY, PARANOID } from '@/test/music'

const queueAlbum = () =>
  act(() => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] }))

const playing = () => useAudioQueue.getState().queue.at

const button = (name: string) => screen.getByRole('button', { name })

describe('Transport', () => {
  it.each(Object.values(TRANSPORTS))(
    'holds Previous, Play or Pause and Next alone, in that order, in the %s',
    (kind) => {
      queueAlbum()
      render(<Transport kind={kind} />)

      expect(
        screen.getAllByRole('button').map((control) => control.getAttribute('aria-label')),
      ).toEqual([PLAYER_COPY.previous, PLAYER_COPY.pause, PLAYER_COPY.next])
    },
  )

  it('pauses and plays, named for what a press will do', async () => {
    queueAlbum()
    act(() => useAudioQueue.getState().engine.state(AUDIO_STATES.playing))
    render(<Transport kind={TRANSPORTS.player} />)

    await userEvent.click(button(PLAYER_COPY.pause))
    expect(useAudioQueue.getState().shouldPlay).toBe(false)
    act(() => useAudioQueue.getState().engine.state(AUDIO_STATES.paused))

    await userEvent.click(button(PLAYER_COPY.play))
    expect(useAudioQueue.getState().shouldPlay).toBe(true)
  })

  it('steps to the next song and back', async () => {
    queueAlbum()
    render(<Transport kind={TRANSPORTS.player} />)
    const first = playing()

    await userEvent.click(button(PLAYER_COPY.next))
    expect(playing()).not.toBe(first)

    await userEvent.click(button(PLAYER_COPY.previous))
    expect(playing()).toBe(first)
  })
})
