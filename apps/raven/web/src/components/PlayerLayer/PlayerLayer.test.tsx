import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { AUDIO_STATES, useAudioQueue } from '@raven/ui/headless'
import { Route, Routes } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { PlayerLayer } from '@/components/PlayerLayer/PlayerLayer'
import { api } from '@/lib/api'
import { useDesktopBridge } from '@/stores/desktop'
import { asDesktop } from '@/test/desktop'
import { albumDetails, mixSummary, musicLibrary } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const audioElements = () => [...document.querySelectorAll('audio')]

describe('PlayerLayer', () => {
  beforeEach(() => {
    useAudioQueue.getState().clear()
    spyOn(api, 'listLibraries').mockResolvedValue([musicLibrary()])
    spyOn(api, 'getLibrary').mockResolvedValue(musicLibrary())
    spyOn(api, 'getAlbum').mockResolvedValue(albumDetails())
    spyOn(api, 'getRecentAlbums').mockResolvedValue({ played: [], added: [] })
    spyOn(api, 'listMixes').mockResolvedValue([mixSummary()])
  })

  afterEach(() => {
    cleanup()
    mock.restore()
    useAudioQueue.getState().clear()
    useDesktopBridge.setState({ desktop: null })
  })

  it("draws the strip Raven's window is dragged by once, over either shell, and none in a browser", () => {
    const renderLayer = () =>
      renderWithProviders({
        ui: (
          <Routes>
            <Route element={<PlayerLayer />}>
              <Route index element={<p>The shell</p>} />
            </Route>
          </Routes>
        ),
        route: '/',
      })
    asDesktop()
    renderLayer()
    expect(screen.getByText('The shell')).toBeInTheDocument()
    expect(document.querySelectorAll('[aria-hidden="true"].titlebar')).toHaveLength(1)
    cleanup()
    useDesktopBridge.setState({ desktop: null })
    renderLayer()
    expect(document.querySelector('.titlebar')).toBeNull()
  })

  it('keeps the same audio element playing from an album in raven to the music mode and back', async () => {
    renderWithProviders({ ui: <AppRoutes />, route: '/albums/7' })
    await screen.findByRole('heading', { level: 1, name: 'OK Computer' })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    act(() => useAudioQueue.getState().engine.state(AUDIO_STATES.playing))
    const [playing] = audioElements()
    expect(playing).toBeDefined()

    const raven = screen.getByRole('navigation', { name: 'Main' })
    fireEvent.click(await within(raven).findByRole('link', { name: 'Music' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Music' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(audioElements()[0]).toBe(playing)
    expect(useAudioQueue.getState().state).toBe(AUDIO_STATES.playing)
    expect(screen.getByRole('region', { name: 'Now playing' })).toHaveTextContent('Airbag')

    const music = screen.getByRole('navigation', { name: 'Music' })
    fireEvent.click(within(music).getByRole('link', { name: 'Back to raven' }))
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(audioElements()[0]).toBe(playing)
    expect(useAudioQueue.getState().queue.items).toEqual([101, 102])
  })

  it('links the bar to the Now Playing of the mode it is in', async () => {
    renderWithProviders({ ui: <AppRoutes />, route: '/music/albums/7' })
    await screen.findByRole('heading', { level: 1, name: 'OK Computer' })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    const bar = screen.getByRole('region', { name: 'Now playing' })
    expect(within(bar).getByRole('link', { name: 'Now playing' })).toHaveAttribute(
      'href',
      '/music/now-playing',
    )
    fireEvent.click(within(bar).getByRole('link', { name: 'Now playing' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Airbag' })).toBeInTheDocument()
    expect(screen.queryAllByRole('link', { name: 'Now playing' })).toEqual([])
  })
})
