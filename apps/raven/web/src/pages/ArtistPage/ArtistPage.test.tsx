import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { ArtistPage } from '@/pages/ArtistPage/ArtistPage'
import { album, artist, artistDetails } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const renderPage = () =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="/artists/:id" element={<ArtistPage />} />
      </Routes>
    ),
    route: '/artists/1',
  })

describe('ArtistPage', () => {
  beforeEach(() => {
    spyOn(api, 'getArtist').mockResolvedValue(
      artistDetails({
        artist: artist({ albumCount: 1, trackCount: 14 }),
        appearsOn: [
          album({ id: 8, title: 'Now 40', artists: [{ id: 5, name: 'Various Artists' }] }),
        ],
      }),
    )
  })

  afterEach(() => {
    cleanup()
    mock.restore()
  })

  it('shows the artist with their albums and what they appear on', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Radiohead' })).toBeTruthy()
    expect(screen.getByText('1 album · 14 tracks')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'OK Computer' })).toHaveAttribute('href', '/albums/7')
    expect(screen.getByRole('heading', { name: 'Appears on' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Now 40' })).toHaveAttribute('href', '/albums/8')
  })

  it('says when nothing of theirs can be seen', async () => {
    spyOn(api, 'getArtist').mockResolvedValue(artistDetails({ albums: [], appearsOn: [] }))
    renderPage()
    expect(await screen.findByText(/No albums of Radiohead's/)).toBeTruthy()
  })
})
