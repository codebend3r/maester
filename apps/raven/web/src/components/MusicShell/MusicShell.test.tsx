import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { MusicShell } from '@/components/MusicShell/MusicShell'
import { api } from '@/lib/api'
import { MUSIC_PATHS } from '@/lib/music'
import { useDesktopBridge } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import { asDesktop, downloadsMain } from '@/test/desktop'
import { musicLibrary } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { atViewportWidth } from '@/test/viewport'

const renderShell = (route: string) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path={MUSIC_PATHS.root} element={<MusicShell />}>
          <Route index element={<h1>home</h1>} />
          <Route path={MUSIC_PATHS.albums} element={<h1>albums</h1>} />
          <Route path={MUSIC_PATHS.album} element={<h1>album</h1>} />
          <Route path={MUSIC_PATHS.search} element={<h1>search</h1>} />
        </Route>
        <Route path="/" element={<h1>raven home</h1>} />
      </Routes>
    ),
    route,
    libraries: [musicLibrary()],
  })

const side = () => screen.getByRole('navigation', { name: 'Music' })
const tabs = () => screen.getByRole('navigation', { name: 'Music tabs' })
const namesOf = (element: HTMLElement) =>
  within(element)
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('MusicShell', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
    useDesktopBridge.setState({ desktop: null })
    useServerReach.setState({ isOffline: false })
  })

  it('offers Home, Library and Search, with Back to raven at the foot', () => {
    spyOn(api, 'listLibraries').mockResolvedValue([musicLibrary()])
    renderShell(MUSIC_PATHS.root)
    expect(namesOf(side())).toEqual(['RavenMusic', 'Home', 'Library', 'Search', 'Back to raven'])
    expect(within(side()).getByRole('link', { name: 'raven Music' })).toHaveAttribute(
      'href',
      '/music',
    )
    expect(within(side()).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(side()).getByRole('link', { name: 'Back to raven' })).toHaveAttribute('href', '/')
    expect(namesOf(tabs())).toEqual(['Home', 'Library', 'Search', 'raven'])
  })

  it('marks Library on an album of the library, and goes back to raven', () => {
    renderShell('/music/albums/7')
    expect(within(side()).getByRole('link', { name: 'Library' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(side()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    fireEvent.click(within(tabs()).getByRole('link', { name: 'Back to raven' }))
    expect(screen.getByRole('heading', { name: 'raven home' })).toBeInTheDocument()
  })

  it('adds Downloads inside Raven, and keeps only it while the server is out of reach', () => {
    asDesktop(downloadsMain())
    renderShell(MUSIC_PATHS.root)
    expect(within(side()).getByRole('link', { name: 'Downloads' })).toHaveAttribute(
      'href',
      '/music/downloads',
    )
    cleanup()
    useServerReach.setState({ isOffline: true })
    renderShell(MUSIC_PATHS.root)
    expect(namesOf(side())).toEqual(['RavenMusic', 'Downloads', 'Back to raven'])
    expect(namesOf(tabs())).toEqual(['Downloads', 'raven'])
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull()
  })

  it('fits a 320px screen with a label on every control', () => {
    const restore = atViewportWidth(320)
    try {
      renderShell(MUSIC_PATHS.root)
      expect(window.matchMedia('(max-width: 48rem)').matches).toBe(true)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
      expect(namesOf(tabs())).toHaveLength(4)
      const controls = [...screen.getAllByRole('link'), ...screen.getAllByRole('button')]
      expect(controls.length).toBeGreaterThan(0)
      controls.forEach((control) => expect(control).toHaveAccessibleName())
    } finally {
      restore()
    }
  })
})
