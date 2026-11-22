import { describe, expect, it, mock } from 'bun:test'
import { PLAYER_COPY } from '@raven/wren'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACTION_SHAPES, DetailAction } from '@/components/DetailAction/DetailAction'
import { ICONS } from '@/ui/WrenIcon/icons'

const ICON = ICONS.queueAdd

describe('DetailAction', () => {
  it('is a button named by its word, and does what a press asks', async () => {
    const onPress = mock()
    render(<DetailAction icon={ICON} label={PLAYER_COPY.queue} onPress={onPress} />)

    const action = screen.getByRole('button', { name: PLAYER_COPY.queue })
    expect(action).toHaveTextContent(PLAYER_COPY.queue)
    await userEvent.click(action)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('is a switch saying whether it is on when it holds a state', () => {
    const { rerender } = render(
      <DetailAction icon={ICON} isOn={false} label={PLAYER_COPY.like} onPress={() => undefined} />,
    )
    expect(screen.getByRole('switch', { name: PLAYER_COPY.like })).not.toBeChecked()

    rerender(<DetailAction icon={ICON} isOn label={PLAYER_COPY.like} onPress={() => undefined} />)
    expect(screen.getByRole('switch', { name: PLAYER_COPY.like })).toBeChecked()
  })

  it('keeps its name when it is drawn as a circle', () => {
    render(
      <DetailAction
        icon={ICON}
        isOn
        label={PLAYER_COPY.follow}
        onPress={() => undefined}
        shape={ACTION_SHAPES.circle}
      />,
    )
    expect(screen.getByRole('switch', { name: PLAYER_COPY.follow })).toBeInTheDocument()
  })
})
