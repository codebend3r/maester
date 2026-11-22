import { describe, expect, it, mock } from 'bun:test'
import { PLAYER_COPY } from '@raven/wren'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavouriteAction } from '@/components/FavouriteAction/FavouriteAction'

describe('FavouriteAction', () => {
  it('says whether it is a favourite, and asks to change it on a press', async () => {
    const onToggle = mock()
    const { rerender } = render(
      <FavouriteAction isOn={false} label={PLAYER_COPY.like} onToggle={onToggle} />,
    )
    const like = screen.getByRole('switch', { name: PLAYER_COPY.like })
    expect(like).not.toBeChecked()

    await userEvent.click(like)
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<FavouriteAction isOn label={PLAYER_COPY.like} onToggle={onToggle} />)
    expect(screen.getByRole('switch', { name: PLAYER_COPY.like })).toBeChecked()
  })
})
