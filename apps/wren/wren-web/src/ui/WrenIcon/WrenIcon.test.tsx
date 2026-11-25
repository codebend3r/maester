import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderKitWithRoutes } from '@/test/render'
import { COLORS } from '@/theme/tokens'
import { ICONS } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'

describe('WrenIcon', () => {
  it('draws an icon a screen reader passes over', () => {
    const { container } = renderKitWithRoutes(
      <WrenIcon color={COLORS.accentText} name={ICONS.heart} />,
    )

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
