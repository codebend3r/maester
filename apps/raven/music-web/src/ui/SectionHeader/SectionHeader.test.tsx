import { describe, expect, it, mock } from 'bun:test'
import { KIT_COPY, LIBRARY_PAGE_COPY } from '@raven/wren'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderKitWithRoutes } from '@/test/render'
import { SectionHeader } from '@/ui/SectionHeader/SectionHeader'

describe('SectionHeader', () => {
  it('heads a section, with See all named for it', async () => {
    const onPress = mock()
    renderKitWithRoutes(<SectionHeader seeAll={{ onPress }} title={LIBRARY_PAGE_COPY.recent} />)

    expect(
      screen.getByRole('heading', { level: 2, name: LIBRARY_PAGE_COPY.recent }),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: KIT_COPY.seeAllOf(LIBRARY_PAGE_COPY.recent) }),
    )

    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("puts a section's own link in See all's place", () => {
    renderKitWithRoutes(
      <SectionHeader
        action={{ label: 'Clear', spoken: 'Clear recent searches', onPress: () => undefined }}
        title="Recent"
      />,
    )

    expect(screen.getByRole('button', { name: 'Clear recent searches' })).toHaveTextContent('Clear')
    expect(screen.queryByText(KIT_COPY.seeAll)).toBeNull()
  })
})
