import { afterEach, describe, expect, it } from 'bun:test'
import { MUSIC_SORTS } from '@raven/core'
import { KIT_COPY, LIBRARY_COPY, LIBRARY_PAGE_COPY, SHARED_ORDER } from '@raven/wren'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { COLLECTION_KINDS, WREN_ROUTES, albumPath, collectionPath } from '@/routes'
import { Library } from '@/screens/Library/Library'
import { AIRBAG, LUCKY, MUSIC, OK_COMPUTER, OK_COMPUTER_TILE, mockMusicApiEach } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { forgetSongs, keepSongs } from '@/test/songProgress'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

const SEARCH_MARK = 'Search is showing'
const ALBUMS_MARK = 'Albums is showing'

type RenderLibraryProps = { formFactor?: FormFactor }

/** Library beside the pages its rows and its search open. */
const renderLibrary = ({ formFactor = FORM_FACTORS.tablet }: RenderLibraryProps = {}) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={<Library />} path={WREN_ROUTES.library} />
        <Route element={<p>{SEARCH_MARK}</p>} path={WREN_ROUTES.search} />
        <Route element={<p>{ALBUMS_MARK}</p>} path={collectionPath(COLLECTION_KINDS.albums)} />
      </Routes>
    ),
    route: WREN_ROUTES.library,
    formFactor,
  })

describe('Library', () => {
  const music = mockMusicApiEach()
  afterEach(forgetSongs)

  it('lists its categories with what each holds, and the newest albums', async () => {
    renderLibrary()
    expect(
      await screen.findByRole('link', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.songs, value: '3' }),
      }),
    ).toHaveAttribute('href', collectionPath(COLLECTION_KINDS.songs))
    // The songs are counted from a page of one; no catalogue is listed for a count.
    expect(music().listTracks).toHaveBeenCalledWith({ libraryId: MUSIC.id, search: '', limit: 1 })
    expect(music().listArtists).not.toHaveBeenCalled()
    expect(music().listAlbums).toHaveBeenCalledTimes(1)
    expect(music().listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      sort: MUSIC_SORTS.added,
      limit: 10,
    })
    expect(
      screen.getByRole('link', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.artists, value: '1' }),
      }),
    ).toHaveAttribute('href', collectionPath(COLLECTION_KINDS.artists))
    expect(
      screen.getByRole('link', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.playlists, value: '1' }),
      }),
    ).toHaveAttribute('href', collectionPath(COLLECTION_KINDS.playlists))
    expect(screen.getByRole('heading', { name: LIBRARY_PAGE_COPY.recent })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: OK_COMPUTER_TILE })).toHaveAttribute(
      'href',
      albumPath(OK_COMPUTER.id),
    )
  })

  it("lists raven's seven music tabs in raven's order, then Songs, each with its count", async () => {
    keepSongs({ partway: [AIRBAG], finished: [LUCKY] })
    renderLibrary()
    await screen.findByRole('link', {
      name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.albums, value: '1' }),
    })
    const rows = screen.getAllByRole('listitem').flatMap((row) => {
      const link = within(row).queryByRole('link')
      return link === null ? [] : [link.getAttribute('href')]
    })
    expect(rows.slice(0, SHARED_ORDER.length)).toEqual(
      SHARED_ORDER.map((segment) => collectionPath(segment)),
    )
    expect(music().getLibraryCounts).toHaveBeenCalledWith(MUSIC.id)
    expect(
      screen.getByRole('link', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.inProgress, value: '1' }),
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.favourites, value: '1' }),
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.finished, value: '1' }),
      }),
    ).toBeInTheDocument()
    // No album is unmatched, so that row says no zero.
    expect(
      screen.getByRole('link', { name: LIBRARY_PAGE_COPY.unmatchedAlbums }),
    ).toBeInTheDocument()
  })

  it('leaves the counts out when raven cannot count them', async () => {
    music().getLibraryCounts.mockRejectedValue(new Error('refused'))
    renderLibrary()
    await screen.findByRole('link', { name: OK_COMPUTER_TILE })
    expect(screen.getByRole('link', { name: LIBRARY_PAGE_COPY.albums })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: LIBRARY_PAGE_COPY.artists })).toBeInTheDocument()
  })

  it('has no Downloads category, since a browser keeps none', async () => {
    renderLibrary()
    await screen.findByRole('link', { name: OK_COMPUTER_TILE })
    expect(
      screen.queryByRole('link', { name: new RegExp(`^${LIBRARY_PAGE_COPY.downloads}`) }),
    ).not.toBeInTheDocument()
  })

  it('shows three rows of two of the newest albums on the narrow layout', async () => {
    renderLibrary({ formFactor: FORM_FACTORS.phone })
    await screen.findByRole('link', { name: OK_COMPUTER_TILE })
    expect(music().listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      sort: MUSIC_SORTS.added,
      limit: 6,
    })
  })

  it('says None yet beside Playlists when there is none, and leaves a zero of songs out', async () => {
    music().listPlaylists.mockResolvedValue([])
    music().listTracks.mockResolvedValue({ tracks: [], total: 0 })
    renderLibrary()
    expect(
      await screen.findByRole('link', {
        name: KIT_COPY.labelled({
          label: LIBRARY_PAGE_COPY.playlists,
          value: LIBRARY_PAGE_COPY.noneYet,
        }),
      }),
    ).toBeInTheDocument()
    await waitFor(() => expect(music().listTracks).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: LIBRARY_PAGE_COPY.songs })).toBeInTheDocument()
  })

  it('opens Albums from its row', async () => {
    renderLibrary()
    await userEvent.click(
      await screen.findByRole('link', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.albums, value: '1' }),
      }),
    )
    expect(await screen.findByText(ALBUMS_MARK)).toBeInTheDocument()
  })

  it('opens Search from the title', async () => {
    renderLibrary()
    await userEvent.click(screen.getByRole('button', { name: LIBRARY_PAGE_COPY.search }))
    expect(await screen.findByText(SEARCH_MARK)).toBeInTheDocument()
  })

  it('says so when raven holds no music', async () => {
    music().listLibraries.mockResolvedValue([])
    renderLibrary()
    expect(await screen.findByText(LIBRARY_COPY.noMusic)).toBeInTheDocument()
  })

  it('says the albums could not be read when raven does not answer', async () => {
    music().listAlbums.mockRejectedValue(new Error('refused'))
    renderLibrary()
    expect(await screen.findByText(LIBRARY_PAGE_COPY.failed)).toBeInTheDocument()
  })
})
