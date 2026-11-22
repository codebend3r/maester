import { afterEach, describe, expect, it } from 'bun:test'
import { SIDEBAR_COPY } from '@raven/wren'
import { act, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sizeWindow } from '@tooling/web/viewport'
import { AppRoutes } from '@/AppRoutes'
import { WREN_ROUTES } from '@/routes'
import { mockMusicApiEach } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { useSidebar } from '@/stores/sidebar'

mockMusicApiEach()

// Wider than a phone, no wider than the rail's `64rem`.
const RAIL_WIDTH = 1000
const WINDOW_HEIGHT = 844

const toggle = () => screen.findByRole('button', { name: SIDEBAR_COPY.name })

afterEach(() => {
  cleanup()
  act(() => useSidebar.setState({ isCollapsed: false }))
})

describe('the sidebar', () => {
  it('folds to its icons and opens again with the toggle', async () => {
    renderWithProviders({ ui: <AppRoutes />, route: WREN_ROUTES.library })
    const button = await toggle()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('title', SIDEBAR_COPY.expand)
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('folds and opens with the B key, and keeps what it was told', async () => {
    renderWithProviders({ ui: <AppRoutes />, route: WREN_ROUTES.library })
    const button = await toggle()
    await userEvent.keyboard('b')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(useSidebar.getState().isCollapsed).toBe(true)
    await userEvent.keyboard('b')
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('is a rail at 64rem and narrower, with no toggle and B doing nothing', async () => {
    renderWithProviders({ ui: <AppRoutes />, route: WREN_ROUTES.library })
    await toggle()
    act(() => sizeWindow({ width: RAIL_WIDTH, height: WINDOW_HEIGHT }))
    expect(screen.queryByRole('button', { name: SIDEBAR_COPY.name })).toBeNull()
    await userEvent.keyboard('b')
    expect(useSidebar.getState().isCollapsed).toBe(false)
  })
})
