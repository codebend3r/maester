import { describe, expect, it } from 'bun:test'
import { HOME_COPY, LIBRARY_PAGE_COPY, TAB_COPY } from '@raven/wren'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { WREN_ROUTES } from '@/routes'
import { TabBar } from '@/ui/TabBar/TabBar'
import { ICONS } from '@/ui/WrenIcon/icons'

const ITEMS = [
  { key: 'home', label: HOME_COPY.title, icon: ICONS.home, href: WREN_ROUTES.home },
  {
    key: 'library',
    label: LIBRARY_PAGE_COPY.title,
    icon: ICONS.library,
    href: WREN_ROUTES.library,
  },
] as const

type BarProps = { active: string }

function Bar({ active }: BarProps) {
  return <TabBar items={ITEMS.map((item) => ({ ...item, isActive: item.key === active }))} />
}

type TabProps = { label: string; at: number }

const tab = ({ label, at }: TabProps) =>
  screen.getByRole('link', { name: TAB_COPY.label({ label, at, count: ITEMS.length }) })

describe('TabBar', () => {
  it('names each tab with its place on the bar, and marks the one showing', () => {
    render(
      <MemoryRouter>
        <Bar active="library" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(tab({ label: HOME_COPY.title, at: 0 })).not.toHaveAttribute('aria-current')
    expect(tab({ label: LIBRARY_PAGE_COPY.title, at: 1 })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(LIBRARY_PAGE_COPY.title)).toBeInTheDocument()
  })

  it('opens the tab pressed', async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<Bar active="home" />} path={WREN_ROUTES.home} />
          <Route element={<p>Library is showing</p>} path={WREN_ROUTES.library} />
        </Routes>
      </MemoryRouter>,
    )

    await userEvent.click(tab({ label: LIBRARY_PAGE_COPY.title, at: 1 }))

    expect(screen.getByText('Library is showing')).toBeInTheDocument()
  })
})
