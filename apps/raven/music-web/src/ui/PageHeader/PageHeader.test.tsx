import { describe, expect, it } from 'bun:test'
import { KIT_COPY, LIBRARY_PAGE_COPY } from '@raven/wren'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WREN_ROUTES } from '@/routes'
import { KIT_PAGES, renderKitWithRoutes } from '@/test/render'
import { IconButton } from '@/ui/IconButton/IconButton'
import { PageHeader } from '@/ui/PageHeader/PageHeader'
import { ICONS } from '@/ui/WrenIcon/icons'

describe('PageHeader', () => {
  it('titles a page, with the way back above it and its actions beside it', async () => {
    renderKitWithRoutes(
      <PageHeader
        actions={<IconButton icon={ICONS.search} label="Search" onPress={() => undefined} />}
        back={{ to: LIBRARY_PAGE_COPY.title, href: WREN_ROUTES.library }}
        title={LIBRARY_PAGE_COPY.albums}
      />,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: LIBRARY_PAGE_COPY.albums }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('link', { name: KIT_COPY.back(LIBRARY_PAGE_COPY.title) }),
    )

    expect(screen.getByText(KIT_PAGES.library)).toBeInTheDocument()
  })
})
