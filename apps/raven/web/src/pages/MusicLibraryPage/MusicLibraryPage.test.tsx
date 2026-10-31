import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ApiError } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { MUSIC_PATHS } from '@/lib/music'
import { MUSIC_LIBRARY_SECTIONS, MusicLibraryPage } from '@/pages/MusicLibraryPage/MusicLibraryPage'
import { album, artist, musicLibrary, playlistSummary, track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const renderPage = (route: string, libraries = [musicLibrary(), musicLibrary({ id: 4 })]) =>
  renderWithProviders({
    ui: (
      <Routes>
        {Object.values(MUSIC_LIBRARY_SECTIONS).map((section) => (
          <Route
            key={section}
            path={`${MUSIC_PATHS.root}/${section}`}
            element={<MusicLibraryPage section={section} />}
          />
        ))}
      </Routes>
    ),
    route,
    libraries,
  })

const lists = () => screen.getByRole('navigation', { name: 'Library lists' })

describe('MusicLibraryPage', () => {
  beforeEach(() => useAudioQueue.getState().clear())

  afterEach(() => {
    cleanup()
    mock.restore()
    useAudioQueue.getState().clear()
  })

  it("lists every music library's albums by title, under links to the four lists", async () => {
    spyOn(api, 'listAlbums').mockImplementation(async ({ libraryId }) =>
      libraryId === 3
        ? [album({ id: 7, title: 'OK Computer', sortTitle: 'OK Computer' })]
        : [album({ id: 8, title: 'Amnesiac', sortTitle: 'Amnesiac', libraryId: 4 })],
    )
    renderPage(MUSIC_PATHS.albums)
    await screen.findByRole('link', { name: 'OK Computer' })
    const titles = screen.getAllByRole('paragraph').map((p) => p.textContent)
    expect(titles.filter((text) => text === 'Amnesiac' || text === 'OK Computer')).toEqual([
      'Amnesiac',
      'OK Computer',
    ])
    expect(within(lists()).getByRole('link', { name: 'Albums' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(lists()).getByRole('link', { name: 'Songs' })).toHaveAttribute(
      'href',
      '/music/songs',
    )
  })

  it('lists each artist once, by name', async () => {
    spyOn(api, 'listArtists').mockImplementation(async ({ libraryId }) =>
      libraryId === 3
        ? [artist(), artist({ id: 2, name: 'Bjork', sortName: 'Bjork' })]
        : [artist()],
    )
    renderPage(MUSIC_PATHS.artists)
    const list = await screen.findByRole('list', { name: 'Artists' })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Bjork', 'Radiohead']),
    )
  })

  it('plays the songs from the one picked, starts a radio from one, and shows more', async () => {
    const listTracks = spyOn(api, 'listTracks').mockImplementation(async ({ offset = 0 }) =>
      offset === 0
        ? { tracks: [track(), track({ id: 102, title: 'Paranoid Android' })], total: 3 }
        : { tracks: [track({ id: 103, title: 'Subterranean' })], total: 3 },
    )
    const getRadio = spyOn(api, 'getRadio').mockResolvedValue([track({ id: 401 })])
    renderPage(MUSIC_PATHS.songs, [musicLibrary()])
    fireEvent.click(await screen.findByRole('button', { name: 'Play Paranoid Android' }))
    expect(useAudioQueue.getState().queue.items).toEqual([101, 102])
    expect(useAudioQueue.getState().queue.at).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Start radio from Airbag' }))
    await waitFor(() => expect(getRadio).toHaveBeenCalledWith({ seed: { kind: 'track', id: 101 } }))
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByRole('button', { name: 'Play Subterranean' })).toBeInTheDocument()
    expect(listTracks).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 }))
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('lists the playlists, and says when raven has no music', async () => {
    spyOn(api, 'listPlaylists').mockResolvedValue([playlistSummary()])
    renderPage(MUSIC_PATHS.playlists)
    expect(await screen.findByRole('list', { name: 'Playlists' })).toHaveTextContent(
      playlistSummary().name,
    )
    cleanup()
    renderPage(MUSIC_PATHS.albums, [])
    expect(await screen.findByText('raven has no music library yet.')).toBeInTheDocument()
    cleanup()
    renderPage(MUSIC_PATHS.songs, [])
    expect(await screen.findByText('raven has no music library yet.')).toBeInTheDocument()
  })

  it('says why a list could not be read', async () => {
    spyOn(api, 'listArtists').mockRejectedValue(new ApiError({ status: 500, message: 'Down' }))
    renderPage(MUSIC_PATHS.artists, [musicLibrary()])
    expect(await screen.findByRole('alert')).toHaveTextContent('Down')
  })
})
