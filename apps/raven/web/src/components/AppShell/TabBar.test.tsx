import { afterEach, describe, expect, it } from 'bun:test'
import { ADMIN_LOCK_STATES, type AdminLock, DESKTOP_PATHS } from '@raven/core'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { TabBar } from '@/components/AppShell/TabBar'
import { useServerReach } from '@/stores/serverReach'
import { asDesktop, downloadsMain } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

type RenderBarProps = {
  route?: string
  hasMusic?: boolean
  adminLock?: AdminLock
}

const renderBar = ({ route = '/', hasMusic = false, adminLock }: RenderBarProps = {}) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="*" element={<TabBar hasMusic={hasMusic} />} />
      </Routes>
    ),
    route,
    adminLock,
  })

const tabs = () => screen.getByRole('navigation', { name: 'Tabs' })
const more = () => within(tabs()).getByRole('button', { name: 'More' })
const sheet = () => screen.getByRole('dialog', { name: 'More' })
const slots = () =>
  [...tabs().children].map((slot) => [slot.textContent, slot.getAttribute('href')])
const iconOf = (element: Element) => element.querySelector('svg')?.dataset.icon
const linksOf = (element: HTMLElement) =>
  within(element)
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')])

describe('TabBar', () => {
  afterEach(() => {
    cleanup()
  })

  it('has five slots: Home, Libraries, Favourites, Binge and More, without music', () => {
    renderBar()
    expect(slots()).toEqual([
      ['Home', '/'],
      ['Libraries', '/libraries'],
      ['Favourites', '/favourites'],
      ['Binge', '/binge'],
      ['More', null],
    ])
    expect([...tabs().children].map(iconOf)).toEqual([
      'home',
      'libraries',
      'heart',
      'popcorn',
      'more',
    ])
    expect(more()).toHaveAttribute('aria-expanded', 'false')
    expect(within(tabs()).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('gives Music the fourth slot once a music library exists', () => {
    renderBar({ hasMusic: true })
    expect(slots()).toEqual([
      ['Home', '/'],
      ['Libraries', '/libraries'],
      ['Favourites', '/favourites'],
      ['Music', '/music'],
      ['More', null],
    ])
  })

  it('marks Libraries on any library page', () => {
    renderBar({ route: '/libraries/3/sagas/9' })
    expect(within(tabs()).getByRole('link', { name: 'Libraries' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('opens a sheet of the rest, with Binge first when Music took its slot, and Manage for an admin', async () => {
    renderBar({ hasMusic: true })
    await userEvent.click(more())
    expect(more()).toHaveAttribute('aria-expanded', 'true')
    expect(more().className).toContain('marked')
    const [main, manage] = within(sheet()).getAllByRole('list')
    expect(main && linksOf(main)).toEqual([
      ['Binge', '/binge'],
      ['Play history', '/history'],
      ['Notifications', '/notifications'],
      ['Settings', '/settings'],
    ])
    expect(within(sheet()).getByRole('heading', { name: 'Manage' })).toBeInTheDocument()
    expect(manage).toHaveAccessibleName('Manage')
    expect(manage && linksOf(manage)).toEqual([
      ['Admin', '/admin'],
      ['Streams', '/streams'],
      ['Reports', '/reports'],
    ])
    expect(within(sheet()).getAllByRole('link').map(iconOf)).toEqual([
      'popcorn',
      'history',
      'bell',
      'settings',
      'settings',
      'playback',
      'alert',
    ])
  })

  it('leaves Binge out of the sheet while it has its own slot', async () => {
    renderBar()
    await userEvent.click(more())
    expect(linksOf(sheet())).toEqual([
      ['Play history', '/history'],
      ['Notifications', '/notifications'],
      ['Settings', '/settings'],
      ['Admin', '/admin'],
      ['Streams', '/streams'],
      ['Reports', '/reports'],
    ])
  })

  it('has no Manage group while the admin lock is on', async () => {
    renderBar({ adminLock: { state: ADMIN_LOCK_STATES.on, available: true } })
    await userEvent.click(more())
    expect(within(sheet()).queryByRole('heading', { name: 'Manage' })).toBeNull()
    expect(linksOf(sheet())).toEqual([
      ['Play history', '/history'],
      ['Notifications', '/notifications'],
      ['Settings', '/settings'],
    ])
  })

  it('adds This Mac and Downloads before Settings inside Raven', async () => {
    asDesktop(downloadsMain())
    renderBar()
    expect(slots()).toHaveLength(5)
    await userEvent.click(more())
    const [main] = within(sheet()).getAllByRole('list')
    expect(main && linksOf(main)).toEqual([
      ['Play history', '/history'],
      ['Notifications', '/notifications'],
      ['This Mac', DESKTOP_PATHS.local],
      ['Downloads', DESKTOP_PATHS.downloads],
      ['Settings', '/settings'],
    ])
  })

  it('marks More, not a tab, while one of its pages is open', () => {
    renderBar({ route: '/settings' })
    expect(more().className).toContain('marked')
    expect(more()).toHaveAttribute('aria-expanded', 'false')
    expect(within(tabs()).queryByRole('link', { current: 'page' })).toBeNull()
  })

  it('leaves More unmarked on a page of its own slot', () => {
    renderBar({ route: '/favourites' })
    expect(more().className).not.toContain('marked')
  })

  it('closes the sheet and leaves for the page a tile chooses', async () => {
    renderBar()
    await userEvent.click(more())
    await userEvent.click(within(sheet()).getByRole('link', { name: 'Settings' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(more()).toHaveAttribute('aria-expanded', 'false')
    expect(more().className).toContain('marked')
  })

  it('closes the sheet on a tile for the page already open', async () => {
    renderBar({ route: '/settings' })
    await userEvent.click(more())
    await userEvent.click(within(sheet()).getByRole('link', { name: 'Settings' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and hands focus back to More', async () => {
    renderBar()
    await userEvent.click(more())
    expect(sheet()).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(more()).toHaveFocus()
  })

  it('closes on a tap on the scrim over the page', async () => {
    renderBar()
    await userEvent.click(more())
    await userEvent.click(within(sheet()).getByRole('button', { name: 'Close More' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(more()).toHaveFocus()
  })

  it('keeps only This Mac, Downloads and Settings, with no More, while Raven cannot reach its server', () => {
    asDesktop(downloadsMain())
    useServerReach.setState({ isOffline: true })
    renderBar({ hasMusic: true })
    expect(slots()).toEqual([
      ['This Mac', DESKTOP_PATHS.local],
      ['Downloads', DESKTOP_PATHS.downloads],
      ['Settings', '/settings'],
    ])
    expect(within(tabs()).queryByRole('button')).toBeNull()
  })

  it('keeps only Settings offline in a browser', () => {
    useServerReach.setState({ isOffline: true })
    renderBar()
    expect(slots()).toEqual([['Settings', '/settings']])
  })
})
