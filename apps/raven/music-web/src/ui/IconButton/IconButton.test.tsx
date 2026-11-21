import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderKitWithRoutes } from '@/test/render'
import { SIZES } from '@/theme/tokens'
import { ICON_BUTTON_VARIANTS, IconButton } from '@/ui/IconButton/IconButton'
import { ICONS } from '@/ui/WrenIcon/icons'

describe('IconButton', () => {
  it("names an icon button, says a toggle's state and answers a press", async () => {
    const onPress = mock()
    renderKitWithRoutes(
      <IconButton
        icon={ICONS.shuffle}
        isSelected
        label="Shuffle"
        onPress={onPress}
        size={SIZES.smallButton}
        variant={ICON_BUTTON_VARIANTS.filled}
      />,
    )
    const button = screen.getByRole('button', { name: 'Shuffle', pressed: true })

    await userEvent.click(button)

    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('answers no press while it is off', async () => {
    const onPress = mock()
    renderKitWithRoutes(<IconButton icon={ICONS.next} isDisabled label="Next" onPress={onPress} />)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(onPress).not.toHaveBeenCalled()
  })
})
