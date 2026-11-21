import { describe, expect, it, mock } from 'bun:test'
import { PLAYER_COPY } from '@raven/wren'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'

describe('PlayButtons', () => {
  it('plays on Play and shuffles on Shuffle', async () => {
    const onPlay = mock()
    const onShuffle = mock()
    render(<PlayButtons onPlay={onPlay} onShuffle={onShuffle} />)

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.play }))
    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(onShuffle).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
    expect(onShuffle).toHaveBeenCalledTimes(1)
  })
})
