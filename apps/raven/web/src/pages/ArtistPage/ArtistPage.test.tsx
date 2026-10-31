import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ArtistDetails } from '@raven/core'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { ArtistPage } from '@/pages/ArtistPage/ArtistPage'
import { useAudioQueue } from '@raven/ui/headless'
import { album, artist, artistDetails, track } from '@/test/music'
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

  it('unmarks a favourite artist before the server answers', async () => {
    spyOn(api, 'getArtist').mockResolvedValue(artistDetails({ isFavourite: true }))
    const answer = Promise.withResolvers<ArtistDetails>()
    const mark = spyOn(api, 'setArtistFavourite').mockImplementation(() => answer.promise)
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Radiohead' })
    const heart = screen.getByRole('button', { name: 'Favourite' })
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(heart)
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'false'))
    expect(mark).toHaveBeenCalledWith({ artistId: 1, favourite: false })
    answer.resolve(artistDetails({ isFavourite: false }))
  })
  it('starts a radio from the artist', async () => {
    const getRadio = spyOn(api, 'getRadio').mockResolvedValue([track({ id: 201 })])
    useAudioQueue.getState().clear()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Radiohead' })
    fireEvent.click(screen.getByRole('button', { name: 'Start radio' }))
    await waitFor(() =>
      expect(useAudioQueue.getState().queue.source).toEqual({
        kind: 'radio',
        id: 1,
        seed: 'artist',
      }),
    )
    expect(getRadio).toHaveBeenCalledWith({ seed: { kind: 'artist', id: 1 } })
    useAudioQueue.getState().clear()
  })

  it("goes back to the music mode's Home there", async () => {
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="/music/artists/:id" element={<ArtistPage />} />
        </Routes>
      ),
      route: '/music/artists/1',
    })
    await screen.findByRole('heading', { level: 1, name: 'Radiohead' })
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/music')
    expect(screen.getByRole('link', { name: 'OK Computer' })).toHaveAttribute(
      'href',
      '/music/albums/7',
    )
  })
})
