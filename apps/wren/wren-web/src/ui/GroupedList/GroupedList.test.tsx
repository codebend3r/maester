import { describe, expect, it } from 'bun:test'
import { SETTINGS_COPY, WREN_ICONS } from '@raven/wren'
import { screen } from '@testing-library/react'
import { renderKitWithRoutes } from '@/test/render'
import { FactRow } from '@/ui/FactRow/FactRow'
import { GroupedList } from '@/ui/GroupedList/GroupedList'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow/NavigationRow'

describe('GroupedList', () => {
  it('groups rows in a card under its heading', () => {
    renderKitWithRoutes(
      <GroupedList heading={SETTINGS_COPY.about}>
        <FactRow icon={WREN_ICONS.info} label={SETTINGS_COPY.version} value="0.9.0" />
        <NavigationRow
          label={SETTINGS_COPY.licenses}
          onPress={() => undefined}
          variant={NAVIGATION_ROW_VARIANTS.settings}
        />
      </GroupedList>,
    )

    expect(screen.getByRole('heading', { name: SETTINGS_COPY.about })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
