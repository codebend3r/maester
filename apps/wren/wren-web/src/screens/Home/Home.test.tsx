import { describe, expect, it, spyOn } from 'bun:test'
import { MUSIC_PAGE, MUSIC_SORTS, plural } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import {
  COUNTS_COPY,
  HOME_COPY,
  KIT_COPY,
  LIBRARY_COPY,
  LIBRARY_PAGE_COPY,
  OFFLINE_COPY,
  RECENT_SORTS,
  type RecentSort,
  WREN_LOCKUP_COPY,
  recentDateLineOf,
} from '@raven/wren'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { COLLECTION_KINDS, WREN_ROUTES, albumPath, collectionPath } from '@/routes'
import { Home } from '@/screens/Home/Home'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import {
  AIRBAG,
  MUSIC,
  OK_COMPUTER,
  OK_COMPUTER_TILE,
  PARANOID,
  SONGS,
  mockMusicApiEach,
} from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

/** OK Computer's tile on Home, read out with the date its order is by. */
const homeTileOf = (sort: RecentSort) =>
  KIT_COPY.labelled({
    label: OK_COMPUTER_TILE,
    value: recentDateLineOf({ album: OK_COMPUTER, sort }),
  })
const HOME_TILE = homeTileOf(RECENT_SORTS.added)

const ALBUM_MARK = 'The album is showing'
const ALBUMS_MARK = 'Albums is showing'
const NOW_PLAYING_MARK = 'Now Playing is showing'

const GREETINGS: readonly string[] = Object.values(HOME_COPY.greeting)

const SHUFFLE_ALL = KIT_COPY.labelled({
  label: HOME_COPY.shuffleAll,
  value: plural({ n: SONGS.total, ...COUNTS_COPY.songs }),
})

type RenderHomeProps = { formFactor?: FormFactor }

/** Home beside the pages its links open. */
const renderHome = ({ formFactor = FORM_FACTORS.tablet }: RenderHomeProps = {}) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={<Home />} path={WREN_ROUTES.home} />
        <Route element={<p>{ALBUM_MARK}</p>} path={albumPath(OK_COMPUTER.id)} />
        <Route element={<p>{ALBUMS_MARK}</p>} path={collectionPath(COLLECTION_KINDS.albums)} />
        <Route element={<p>{NOW_PLAYING_MARK}</p>} path={WREN_ROUTES.nowPlaying} />
      </Routes>
    ),
    route: WREN_ROUTES.home,
    formFactor,
  })

describe('Home', () => {
  const music = mockMusicApiEach()

  it("greets the listener and shows every music library's newest albums, and opens one", async () => {
    renderHome()
    const tile = await screen.findByRole('link', { name: HOME_TILE })
    expect(screen.getByRole('heading', { name: LIBRARY_PAGE_COPY.recent })).toBeInTheDocument()
    expect(GREETINGS).toContain(screen.getByRole('heading', { level: 1 }).textContent)
    // Six rows of six on the wide layout.
    expect(music().listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      sort: MUSIC_SORTS.added,
      limit: 36,
    })

    await userEvent.click(tile)
    expect(await screen.findByText(ALBUM_MARK)).toBeInTheDocument()
  })

  it('asks for six rows of two on the narrow layout, under the lockup and the server chip', async () => {
    renderHome({ formFactor: FORM_FACTORS.phone })
    await screen.findByRole('link', { name: HOME_TILE })
    expect(music().listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      sort: MUSIC_SORTS.added,
      limit: 12,
    })
    expect(screen.getByRole('img', { name: WREN_LOCKUP_COPY.name })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: new RegExp(`^${LIBRARY_PAGE_COPY.playlists}`) }),
    ).not.toBeInTheDocument()
  })

  it('lists the albums by their latest release once asked, and keeps the choice', async () => {
    renderHome()
    await userEvent.click(await screen.findByRole('radio', { name: HOME_COPY.sorts.release }))
    expect(
      await screen.findByRole('heading', { name: HOME_COPY.latestReleases }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(music().listAlbums).toHaveBeenCalledWith({
        libraryId: MUSIC.id,
        sort: MUSIC_SORTS.release,
        limit: 36,
      }),
    )
    expect(useWrenPrefs.getState().homeSort).toBe(RECENT_SORTS.release)
    expect(
      await screen.findByRole('link', { name: homeTileOf(RECENT_SORTS.release) }),
    ).toHaveTextContent(recentDateLineOf({ album: OK_COMPUTER, sort: RECENT_SORTS.release }))
  })

  it('shows each album the day it was added, while Home is by date added', async () => {
    renderHome()
    expect(await screen.findByRole('link', { name: HOME_TILE })).toHaveTextContent(
      recentDateLineOf({ album: OK_COMPUTER, sort: RECENT_SORTS.added }),
    )
  })

  it('opens Albums from See all', async () => {
    renderHome()
    await userEvent.click(
      await screen.findByRole('link', { name: KIT_COPY.seeAllOf(LIBRARY_PAGE_COPY.recent) }),
    )
    expect(await screen.findByText(ALBUMS_MARK)).toBeInTheDocument()
  })

  it('shuffles a random page of every song, dealt by a new seed each press', async () => {
    const roll = spyOn(Math, 'random').mockReturnValue(0.25)
    renderHome()
    await userEvent.click(await screen.findByRole('button', { name: SHUFFLE_ALL }))
    roll.mockRestore()
    expect(music().listTracks).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      sort: MUSIC_SORTS.random,
      seed: 250_000,
      limit: MUSIC_PAGE.most,
      offset: 0,
    })
    await waitFor(() => expect(useAudioQueue.getState().queue.isShuffled).toBe(true))
    expect(useAudioQueue.getState().queue.items).toHaveLength(SONGS.tracks.length)
  })

  it('keeps Shuffle all pressable with no count while the songs are counted', async () => {
    music().listTracks.mockImplementationOnce(() => new Promise(() => {}))
    renderHome()
    const shuffle = await screen.findByRole('button', { name: HOME_COPY.shuffleAll })
    expect(shuffle).toBeEnabled()
    await waitFor(() =>
      expect(music().listTracks).toHaveBeenCalledWith({
        libraryId: MUSIC.id,
        search: '',
        limit: 1,
      }),
    )
    expect(music().listAlbums).not.toHaveBeenCalledWith(
      expect.objectContaining({ sort: MUSIC_SORTS.title }),
    )
  })

  it('turns Shuffle all off once the songs are known to be none', async () => {
    music().listTracks.mockResolvedValue({ tracks: [], total: 0 })
    renderHome()
    const shuffle = await screen.findByRole('button', {
      name: KIT_COPY.labelled({ label: HOME_COPY.shuffleAll, value: LIBRARY_PAGE_COPY.noneYet }),
    })
    expect(shuffle).toBeDisabled()
  })

  it("opens Playlists from the wide layout's shortcut, which counts them", async () => {
    renderHome()
    const playlists = await screen.findByRole('link', {
      name: KIT_COPY.labelled({
        label: LIBRARY_PAGE_COPY.playlists,
        value: plural({ n: 1, ...COUNTS_COPY.playlists }),
      }),
    })
    expect(playlists).toHaveAttribute('href', collectionPath(COLLECTION_KINDS.playlists))
  })

  it('offers a first playlist where there is none', async () => {
    music().listPlaylists.mockResolvedValue([])
    renderHome()
    expect(
      await screen.findByRole('link', {
        name: KIT_COPY.labelled({
          label: LIBRARY_PAGE_COPY.playlists,
          value: HOME_COPY.firstPlaylist,
        }),
      }),
    ).toBeInTheDocument()
  })

  it('offers to continue the queue where it stands, and resumes it', async () => {
    renderHome({ formFactor: FORM_FACTORS.phone })
    await screen.findByRole('link', { name: HOME_TILE })
    act(() => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID], startAt: 1 }))
    act(() => useAudioQueue.getState().pause())
    const line = HOME_COPY.continueLine({
      artists: 'Radiohead',
      track: HOME_COPY.trackOf({ at: 2, count: 2 }),
    })
    const card = await screen.findByRole('link', {
      name: HOME_COPY.continueLabel({ album: OK_COMPUTER.title, line }),
    })
    expect(card).toHaveAttribute('href', WREN_ROUTES.nowPlaying)

    await userEvent.click(screen.getByRole('button', { name: HOME_COPY.resume }))
    expect(useAudioQueue.getState().shouldPlay).toBe(true)
  })

  it("names the track after its place on the wide layout's card", async () => {
    renderHome()
    await screen.findByRole('link', { name: HOME_TILE })
    act(() => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID], startAt: 1 }))
    const line = HOME_COPY.continueLine({
      artists: HOME_COPY.continueLine({
        artists: 'Radiohead',
        track: HOME_COPY.trackOf({ at: 2, count: 2 }),
      }),
      track: PARANOID.title,
    })
    expect(
      await screen.findByRole('link', {
        name: HOME_COPY.continueLabel({ album: OK_COMPUTER.title, line }),
      }),
    ).toBeInTheDocument()
  })

  it('says so when raven holds no music', async () => {
    music().listLibraries.mockResolvedValue([])
    renderHome()
    expect(await screen.findByText(LIBRARY_COPY.noMusic)).toBeInTheDocument()
  })

  it('says raven is out of reach, and why, when it does not answer', async () => {
    music().listLibraries.mockRejectedValue(new Error('The server is asleep.'))
    renderHome()
    expect(await screen.findByRole('heading', { name: OFFLINE_COPY.title })).toBeInTheDocument()
    expect(screen.getByText('The server is asleep.')).toBeInTheDocument()
    expect(screen.getByText(LIBRARY_PAGE_COPY.failed)).toBeInTheDocument()
  })
})
