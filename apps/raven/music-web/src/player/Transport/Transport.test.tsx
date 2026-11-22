import { describe, expect, it } from 'bun:test'
import { REPEAT_MODES } from '@raven/core'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, TRANSPORTS } from '@raven/wren'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepeatToggle, ShuffleToggle, Transport } from '@/player/Transport/Transport'
import { AIRBAG, LUCKY, PARANOID } from '@/test/music'

const queueAlbum = () =>
  act(() => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] }))

const playing = () => useAudioQueue.getState().queue.at

const button = (name: string) => screen.getByRole('button', { name })

describe('Transport', () => {
  it('holds Shuffle, Previous, Play or Pause, Next and Repeat, in that order', () => {
    queueAlbum()
    render(<Transport kind={TRANSPORTS.bar} />)

    expect(
      screen.getAllByRole('button').map((control) => control.getAttribute('aria-label')),
    ).toEqual([
      PLAYER_COPY.shuffle,
      PLAYER_COPY.previous,
      PLAYER_COPY.pause,
      PLAYER_COPY.next,
      PLAYER_COPY.repeat[REPEAT_MODES.off],
    ])
  })

  it("leaves Shuffle and Repeat to Up next's own head", () => {
    queueAlbum()
    render(<Transport kind={TRANSPORTS.queue} />)

    expect(screen.queryByRole('button', { name: PLAYER_COPY.shuffle })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

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

  it('turns Shuffle on and off, saying which it is', async () => {
    queueAlbum()
    render(<ShuffleToggle />)
    expect(button(PLAYER_COPY.shuffle)).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(button(PLAYER_COPY.shuffle))

    expect(useAudioQueue.getState().queue.isShuffled).toBe(true)
    expect(button(PLAYER_COPY.shuffle)).toHaveAttribute('aria-pressed', 'true')
  })

  it('moves Repeat from off to all to one and back, named for the mode it is in', async () => {
    queueAlbum()
    render(<RepeatToggle isFilled />)

    await userEvent.click(button(PLAYER_COPY.repeat[REPEAT_MODES.off]))
    expect(button(PLAYER_COPY.repeat[REPEAT_MODES.all])).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(button(PLAYER_COPY.repeat[REPEAT_MODES.all]))
    await userEvent.click(button(PLAYER_COPY.repeat[REPEAT_MODES.one]))

    expect(button(PLAYER_COPY.repeat[REPEAT_MODES.off])).toHaveAttribute('aria-pressed', 'false')
  })
})
