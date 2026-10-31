import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { MusicSearchPage } from '@/pages/MusicSearchPage/MusicSearchPage'
import { album, artist, musicLibrary, track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const renderPage = (route: string) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="/music/search" element={<MusicSearchPage />} />
      </Routes>
    ),
    route,
    libraries: [musicLibrary()],
  })

describe('MusicSearchPage', () => {
  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('says what it searches before anything is asked, and asks for nothing', () => {
    const listAlbums = spyOn(api, 'listAlbums')
    renderPage('/music/search')
    expect(screen.getByRole('searchbox', { name: 'Search music' })).toBeInTheDocument()
    expect(
      screen.getByText('Search every music library for albums, artists and songs.'),
    ).toBeInTheDocument()
    expect(listAlbums).not.toHaveBeenCalled()
  })

  it('lists the albums, artists and songs that match, from the music libraries alone', async () => {
    const listAlbums = spyOn(api, 'listAlbums').mockResolvedValue([album()])
    spyOn(api, 'listArtists').mockResolvedValue([artist()])
    spyOn(api, 'listTracks').mockResolvedValue({ tracks: [track()], total: 1 })
    renderPage('/music/search?q=ok')
    const albums = await screen.findByRole('region', { name: 'Albums' })
    expect(await within(albums).findByRole('link', { name: 'OK Computer' })).toBeInTheDocument()
    expect(listAlbums).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 3, search: 'ok' }))
    const artists = screen.getByRole('region', { name: 'Artists' })
    expect(await within(artists).findByRole('link', { name: 'Radiohead' })).toBeInTheDocument()
    const songs = screen.getByRole('region', { name: 'Songs' })
    expect(await within(songs).findByRole('button', { name: 'Play Airbag' })).toBeInTheDocument()
  })

  it('says when nothing matches', async () => {
    spyOn(api, 'listAlbums').mockResolvedValue([])
    spyOn(api, 'listArtists').mockResolvedValue([])
    spyOn(api, 'listTracks').mockResolvedValue({ tracks: [], total: 0 })
    renderPage('/music/search?q=zz')
    expect(await screen.findByText('No albums match "zz".')).toBeInTheDocument()
    expect(await screen.findByText('No artists match "zz".')).toBeInTheDocument()
    expect(await screen.findByText('No songs match "zz".')).toBeInTheDocument()
  })
})
