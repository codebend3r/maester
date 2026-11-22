import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { MUSIC_PAGE, MUSIC_SORTS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { KIT_COPY, LIBRARY_COPY, RECENT_KINDS, SEARCH_COPY } from '@raven/wren'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { COLLECTION_KINDS, WREN_ROUTES, albumPath, artistPath, collectionPath } from '@/routes'
import { Search } from '@/screens/Search/Search'
import { useRecentSearches } from '@/stores/recentSearches'
import { reachEnds, watchIntersections } from '@/test/intersection'
import {
  AIRBAG,
  MUSIC,
  OK_COMPUTER,
  OK_COMPUTER_TILE,
  PARANOID,
  RADIOHEAD,
  mockMusicApiEach,
} from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

const ARTIST_PAGE = 'the artist page'

const ALBUM_PAGE = 'the album page'

const TOP_SONG = KIT_COPY.labelled({
  label: SEARCH_COPY.topResult({ kind: SEARCH_COPY.song }),
  value: AIRBAG.title,
})

/** What puts the browser's IntersectionObserver back after a test that paged. */
type Mocks = { restoreIntersections: (() => void) | null }

const mocks: Mocks = { restoreIntersections: null }

const music = mockMusicApiEach()

type RenderSearchProps = { formFactor?: FormFactor }

const renderSearch = ({ formFactor = FORM_FACTORS.phone }: RenderSearchProps = {}) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={<Search />} path={WREN_ROUTES.search} />
        <Route element={<p>{ARTIST_PAGE}</p>} path={WREN_ROUTES.artist} />
        <Route element={<p>{ALBUM_PAGE}</p>} path={WREN_ROUTES.album} />
      </Routes>
    ),
    route: WREN_ROUTES.search,
    formFactor,
  })

const box = () => screen.getByRole('searchbox', { name: SEARCH_COPY.label })

/** Types into the box and presses Enter, so the search runs at once. */
const searchFor = async (text: string) => {
  await userEvent.clear(box())
  await userEvent.type(box(), `${text}{Enter}`)
}

describe('Search', () => {
  beforeEach(() => {
    music().listTracks.mockResolvedValue({ tracks: [AIRBAG], total: 1 })
  })

  afterEach(() => {
    cleanup()
    mocks.restoreIntersections?.()
    mocks.restoreIntersections = null
  })

  it('shows the albums, artists and songs the search was answered with', async () => {
    renderSearch()
    await searchFor('radio')

    expect(await screen.findByRole('link', { name: OK_COMPUTER_TILE })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: RADIOHEAD.name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: AIRBAG.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: TOP_SONG })).toBeInTheDocument()
    const search = { libraryId: MUSIC.id, search: 'radio', sort: MUSIC_SORTS.title }
    expect(music().listAlbums).toHaveBeenCalledWith(search)
    expect(music().listArtists).toHaveBeenCalledWith({ libraryId: MUSIC.id, search: 'radio' })
    expect(music().listTracks).toHaveBeenCalledWith({
      ...search,
      limit: MUSIC_PAGE.most,
      offset: 0,
      seed: 0,
    })
  })

  it('sets the songs and albums beside the artists on the wide layout, with no top result', async () => {
    renderSearch({ formFactor: FORM_FACTORS.tablet })
    await searchFor('radio')

    expect(await screen.findByRole('button', { name: AIRBAG.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: OK_COMPUTER_TILE })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: RADIOHEAD.name })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: TOP_SONG })).toBeNull()
  })

  it('plays a song found from it, and narrows the results by a chip', async () => {
    renderSearch()
    await searchFor('radio')
    await userEvent.click(await screen.findByRole('button', { name: AIRBAG.title }))
    expect(useAudioQueue.getState().tracks[AIRBAG.id]).toEqual(AIRBAG)
    expect(useRecentSearches.getState().recents).toEqual([
      { kind: RECENT_KINDS.query, text: 'radio' },
    ])

    await userEvent.click(screen.getByRole('radio', { name: SEARCH_COPY.artists }))
    expect(await screen.findByRole('link', { name: RADIOHEAD.name })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: AIRBAG.title })).toBeNull()

    await userEvent.click(screen.getByRole('radio', { name: SEARCH_COPY.songs }))
    expect(screen.getByRole('button', { name: AIRBAG.title })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: RADIOHEAD.name })).toBeNull()
  })

  it('asks for the next page of songs as the list nears its end', async () => {
    mocks.restoreIntersections = watchIntersections()
    music().listTracks.mockImplementation(async ({ offset = 0 }) => ({
      tracks: offset === 0 ? [AIRBAG] : [PARANOID],
      total: 2,
    }))
    renderSearch()
    await searchFor('radio')
    await userEvent.click(await screen.findByRole('radio', { name: SEARCH_COPY.songs }))
    expect(screen.getByRole('button', { name: AIRBAG.title })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PARANOID.title })).toBeNull()

    await reachEnds()
    expect(await screen.findByRole('button', { name: PARANOID.title })).toBeInTheDocument()
    expect(music().listTracks).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 }))
  })

  it('plays the top result from its Play', async () => {
    renderSearch()
    await searchFor('radio')
    await userEvent.click(
      await screen.findByRole('button', { name: SEARCH_COPY.play(AIRBAG.title) }),
    )
    expect(useAudioQueue.getState().tracks[AIRBAG.id]).toEqual(AIRBAG)
  })

  it('asks nothing until something is typed, and offers to clear a search that matched nothing', async () => {
    music().listAlbums.mockResolvedValue([])
    music().listArtists.mockResolvedValue([])
    music().listTracks.mockResolvedValue({ tracks: [], total: 0 })
    renderSearch()
    expect(screen.getByRole('heading', { name: SEARCH_COPY.browse })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: SEARCH_COPY.title })).toBeInTheDocument()
    expect(music().listAlbums).not.toHaveBeenCalled()

    await searchFor('zz')
    expect(await screen.findByText(SEARCH_COPY.noMatches('zz'))).toBeInTheDocument()
    expect(screen.getByText(SEARCH_COPY.noMatchesHint)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: SEARCH_COPY.title })).toBeNull()
    // The field's own clear button is called the same aloud; this is the one in words.
    await userEvent.click(screen.getByText(SEARCH_COPY.clearSearch))
    expect(await screen.findByRole('heading', { name: SEARCH_COPY.browse })).toBeInTheDocument()
    expect(box()).toHaveValue('')
  })

  it('says a search is on its way until it is answered', async () => {
    music().listTracks.mockReturnValue(new Promise(() => undefined))
    music().listAlbums.mockReturnValue(new Promise(() => undefined))
    music().listArtists.mockReturnValue(new Promise(() => undefined))
    renderSearch()
    await searchFor('radio')
    expect(await screen.findByLabelText(SEARCH_COPY.searching)).toBeInTheDocument()
  })

  it('says why a search failed', async () => {
    music().listAlbums.mockRejectedValue(new Error("raven can't be reached."))
    renderSearch()
    await searchFor('radio')
    expect(await screen.findByText(SEARCH_COPY.failed)).toBeInTheDocument()
    expect(screen.getByText(SEARCH_COPY.failedHint("raven can't be reached."))).toBeInTheDocument()
  })

  it('says raven holds no music, rather than searching for ever, when it has no music library', async () => {
    music().listLibraries.mockResolvedValue([])
    renderSearch()
    await searchFor('radio')
    expect(await screen.findByText(LIBRARY_COPY.noMusic)).toBeInTheDocument()
    expect(screen.queryByLabelText(SEARCH_COPY.searching)).toBeNull()
    expect(music().listTracks).not.toHaveBeenCalled()
  })

  it("links each Browse tile to Library's list, with none for downloads", () => {
    renderSearch()
    expect(screen.getByRole('link', { name: SEARCH_COPY.albums })).toHaveAttribute(
      'href',
      collectionPath(COLLECTION_KINDS.albums),
    )
    expect(screen.getByRole('link', { name: SEARCH_COPY.artists })).toHaveAttribute(
      'href',
      collectionPath(COLLECTION_KINDS.artists),
    )
    expect(screen.getByRole('link', { name: SEARCH_COPY.songs })).toHaveAttribute(
      'href',
      collectionPath(COLLECTION_KINDS.songs),
    )
    expect(screen.queryByRole('link', { name: SEARCH_COPY.downloaded })).toBeNull()
  })

  it('links an album and an artist found to their pages, as every other tile and row is', async () => {
    renderSearch()
    await searchFor('radio')

    expect(await screen.findByRole('link', { name: OK_COMPUTER_TILE })).toHaveAttribute(
      'href',
      albumPath(OK_COMPUTER.id),
    )
    expect(screen.getByRole('link', { name: RADIOHEAD.name })).toHaveAttribute(
      'href',
      artistPath(RADIOHEAD.id),
    )
  })

  it('remembers an album opened from its link', async () => {
    renderSearch()
    await searchFor('radio')
    await userEvent.click(await screen.findByRole('link', { name: OK_COMPUTER_TILE }))

    expect(screen.getByText(ALBUM_PAGE)).toBeInTheDocument()
    expect(useRecentSearches.getState().recents[0]).toEqual({
      kind: RECENT_KINDS.album,
      id: OK_COMPUTER.id,
      title: OK_COMPUTER.title,
      artists: RADIOHEAD.name,
    })
  })

  it('remembers a search submitted and an artist opened', async () => {
    renderSearch()
    await searchFor('radio')
    await userEvent.click(await screen.findByRole('link', { name: RADIOHEAD.name }))

    expect(screen.getByText(ARTIST_PAGE)).toBeInTheDocument()
    expect(useRecentSearches.getState().recents).toEqual([
      { kind: RECENT_KINDS.artist, id: RADIOHEAD.id, name: RADIOHEAD.name },
      { kind: RECENT_KINDS.query, text: 'radio' },
    ])
  })

  it('searches a recent search again, opens a recent artist, and forgets them', async () => {
    useRecentSearches.setState({
      recents: [
        { kind: RECENT_KINDS.artist, id: RADIOHEAD.id, name: RADIOHEAD.name },
        { kind: RECENT_KINDS.query, text: 'radio' },
      ],
    })
    const { unmount } = renderSearch()
    expect(screen.getByRole('heading', { name: SEARCH_COPY.recent })).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', {
        name: KIT_COPY.labelled({ label: 'radio', value: SEARCH_COPY.recentSearch }),
      }),
    )
    expect(box()).toHaveValue('radio')
    expect(await screen.findByRole('link', { name: OK_COMPUTER_TILE })).toBeInTheDocument()

    await searchFor('')
    await userEvent.click(
      await screen.findByRole('button', { name: SEARCH_COPY.removeRecent(RADIOHEAD.name) }),
    )
    expect(
      screen.queryByRole('button', { name: SEARCH_COPY.removeRecent(RADIOHEAD.name) }),
    ).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: SEARCH_COPY.clearRecentLabel }))
    expect(screen.queryByRole('heading', { name: SEARCH_COPY.recent })).toBeNull()
    unmount()

    useRecentSearches.setState({
      recents: [{ kind: RECENT_KINDS.artist, id: RADIOHEAD.id, name: RADIOHEAD.name }],
    })
    renderSearch()
    await userEvent.click(
      screen.getByRole('link', {
        name: KIT_COPY.labelled({ label: RADIOHEAD.name, value: SEARCH_COPY.recentArtist }),
      }),
    )
    expect(screen.getByText(ARTIST_PAGE)).toBeInTheDocument()
    expect(artistPath(RADIOHEAD.id)).toBe(`/artist/${RADIOHEAD.id}`)
  })
})
