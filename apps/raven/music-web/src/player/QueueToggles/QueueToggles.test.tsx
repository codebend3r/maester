import { describe, expect, it } from 'bun:test'
import { REPEAT_MODES } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY } from '@raven/wren'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepeatToggle, ShuffleToggle } from '@/player/QueueToggles/QueueToggles'
import { AIRBAG, LUCKY, PARANOID } from '@/test/music'

const queueAlbum = () =>
  act(() => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID, LUCKY] }))

const button = (name: string) => screen.getByRole('button', { name })

describe('QueueToggles', () => {
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
    render(<RepeatToggle />)

    await userEvent.click(button(PLAYER_COPY.repeat[REPEAT_MODES.off]))
    expect(button(PLAYER_COPY.repeat[REPEAT_MODES.all])).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(button(PLAYER_COPY.repeat[REPEAT_MODES.all]))
    await userEvent.click(button(PLAYER_COPY.repeat[REPEAT_MODES.one]))

    expect(button(PLAYER_COPY.repeat[REPEAT_MODES.off])).toHaveAttribute('aria-pressed', 'false')
  })
})
