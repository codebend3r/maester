import { describe, expect, it, mock } from 'bun:test'
import { KIT_COPY, LIBRARY_PAGE_COPY, WREN_ICONS } from '@raven/wren'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderKitWithRoutes } from '@/test/render'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow/NavigationRow'

describe('NavigationRow', () => {
  it('reads a navigation row with its value, and opens what it leads to', async () => {
    const onPress = mock()
    renderKitWithRoutes(
      <NavigationRow
        icon={WREN_ICONS.song}
        label={LIBRARY_PAGE_COPY.songs}
        onPress={onPress}
        value="1,980"
        variant={NAVIGATION_ROW_VARIANTS.library}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.songs, value: '1,980' }),
      }),
    )

    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
