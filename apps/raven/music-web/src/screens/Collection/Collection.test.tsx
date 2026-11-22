import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  LETTERS,
  MATCH_STATES,
  MUSIC_PAGE,
  MUSIC_SORTS,
  MUSIC_SORT_LABELS,
  type MusicSort,
  plural,
} from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import {
  COUNTS_COPY,
  COVER_SIZES,
  KIT_COPY,
  FINISHED_SHOWN,
  LIBRARY_PAGE_COPY,
  LIBRARY_SEGMENTS,
  NEW_PLAYLIST_COPY,
  PLAYER_COPY,
  countsLineOf,
} from '@raven/wren'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, generatePath } from 'react-router-dom'
import {
  COLLECTION_KINDS,
  type CollectionKind,
  WREN_ROUTES,
  WREN_ROUTE_PARAMS,
  albumPath,
  artistPath,
  collectionPath,
  playlistPath,
} from '@/routes'
import { Collection } from '@/screens/Collection/Collection'
import { useToast } from '@/stores/toast'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { reachEnds, watchIntersections } from '@/test/intersection'
import {
  AIRBAG,
  LUCKY,
  MIXTAPE,
  MUSIC,
  OK_COMPUTER,
  OK_COMPUTER_TILE,
  PARANOID,
  RADIOHEAD,
  ROAD_TRIP,
  mockMusicAndWritesEach,
  trackFor,
} from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

/** A full first page of a library holding more songs than one page. */
const FIRST_PAGE = Array.from({ length: MUSIC_PAGE.most }, (_, at) =>
  trackFor({ id: 1000 + at, title: `Song ${at + 1}` }),
)

const BACK = KIT_COPY.back(LIBRARY_PAGE_COPY.title)

const LIBRARY_MARK = 'Library is showing'
const ROAD_TRIP_MARK = 'Road trip is showing'

const sortButtonOf = (sort: MusicSort): string =>
  LIBRARY_PAGE_COPY.sortLabel(MUSIC_SORT_LABELS[sort])

type RenderCollectionProps = {
  kind: CollectionKind
  formFactor?: FormFactor
  /** Whether Library is behind the page, as when it was opened from its row. */
  isFromLibrary?: boolean
}

/** A category page beside the pages it opens. */
const renderCollection = ({
  kind,
  formFactor = FORM_FACTORS.tablet,
  isFromLibrary = false,
}: RenderCollectionProps) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={<Collection />} path={WREN_ROUTES.collection} />
        <Route element={<p>{LIBRARY_MARK}</p>} path={WREN_ROUTES.library} />
        <Route element={<p>{ROAD_TRIP_MARK}</p>} path={playlistPath(ROAD_TRIP.id)} />
      </Routes>
    ),
    route: collectionPath(kind),
    behind: isFromLibrary ? [WREN_ROUTES.library] : [],
    formFactor,
  })

describe('Collection', () => {
  const state: { unwatch: (() => void) | null } = { unwatch: null }
  const mocked = mockMusicAndWritesEach()
  const music = () => mocked().music

  beforeEach(() => {
    state.unwatch = watchIntersections()
  })

  afterEach(() => {
    cleanup()
    state.unwatch?.()
  })

  describe('Albums', () => {
    it('lists every album by title with how many there are, each opening its page', async () => {
      renderCollection({ kind: COLLECTION_KINDS.albums })
      expect(await screen.findByRole('link', { name: OK_COMPUTER_TILE })).toHaveAttribute(
        'href',
        albumPath(OK_COMPUTER.id),
      )
      expect(screen.getByRole('heading', { name: LIBRARY_PAGE_COPY.albums })).toBeInTheDocument()
      expect(music().listAlbums).toHaveBeenCalledWith({
        libraryId: MUSIC.id,
        search: '',
        sort: MUSIC_SORTS.title,
      })
      expect(screen.getByText(plural({ n: 1, ...COUNTS_COPY.albums }))).toBeInTheDocument()
    })

    it('finds albums by what is typed, and sorts them', async () => {
      const second = { ...OK_COMPUTER, id: 8, title: 'Amnesiac', sortTitle: 'Amnesiac', year: 2001 }
      music().listAlbums.mockResolvedValue([second, OK_COMPUTER])
      renderCollection({ kind: COLLECTION_KINDS.albums })
      await screen.findByRole('link', { name: OK_COMPUTER_TILE })
      const titlesShown = () =>
        screen
          .getAllByRole('link', { name: /Radiohead$/ })
          .map((tile) => tile.getAttribute('aria-label'))
      expect(titlesShown()).toEqual([
        KIT_COPY.labelled({ label: second.title, value: 'Radiohead' }),
        OK_COMPUTER_TILE,
      ])

      await userEvent.click(screen.getByRole('button', { name: sortButtonOf(MUSIC_SORTS.title) }))
      await userEvent.click(
        await screen.findByRole('radio', { name: MUSIC_SORT_LABELS[MUSIC_SORTS.year] }),
      )
      expect(
        await screen.findByRole('button', { name: sortButtonOf(MUSIC_SORTS.year) }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('radio')).not.toBeInTheDocument()
      // By year, as raven lists a discography: the earliest first.
      expect(titlesShown()).toEqual([
        OK_COMPUTER_TILE,
        KIT_COPY.labelled({ label: second.title, value: 'Radiohead' }),
      ])

      await userEvent.type(screen.getByLabelText(LIBRARY_PAGE_COPY.searchAlbums), 'ok comp')
      await waitFor(() => expect(titlesShown()).toEqual([OK_COMPUTER_TILE]))

      await userEvent.type(screen.getByLabelText(LIBRARY_PAGE_COPY.searchAlbums), 'zzz')
      expect(await screen.findByText(LIBRARY_PAGE_COPY.noMatches)).toBeInTheDocument()
      // The albums were listed once: finding and sorting ask the server nothing.
      expect(music().listAlbums).toHaveBeenCalledTimes(1)
    })

    it('marks the sort in use in the sheet', async () => {
      renderCollection({ kind: COLLECTION_KINDS.albums })
      await userEvent.click(
        await screen.findByRole('button', { name: sortButtonOf(MUSIC_SORTS.title) }),
      )
      expect(
        await screen.findByRole('radio', { name: MUSIC_SORT_LABELS[MUSIC_SORTS.title] }),
      ).toBeChecked()
      expect(
        screen.getByRole('radio', { name: MUSIC_SORT_LABELS[MUSIC_SORTS.artist] }),
      ).not.toBeChecked()
    })

    it("offers raven's sorts, in raven's order and words", async () => {
      renderCollection({ kind: COLLECTION_KINDS.albums })
      await userEvent.click(
        await screen.findByRole('button', { name: sortButtonOf(MUSIC_SORTS.title) }),
      )
      const offered = (await screen.findAllByRole('radio')).map((radio) => radio.textContent)
      expect(offered).toEqual(Object.values(MUSIC_SORTS).map((sort) => MUSIC_SORT_LABELS[sort]))
    })

    it('draws the covers at the size picked, and keeps it', async () => {
      renderCollection({ kind: COLLECTION_KINDS.albums })
      const medium = LIBRARY_PAGE_COPY.coverSizes[COVER_SIZES.medium]
      await userEvent.click(
        await screen.findByRole('button', { name: LIBRARY_PAGE_COPY.coverSizeLabel(medium) }),
      )
      const offered = (await screen.findAllByRole('radio')).map((radio) => radio.textContent)
      expect(offered).toEqual(
        Object.values(COVER_SIZES).map((size) => LIBRARY_PAGE_COPY.coverSizes[size]),
      )
      await userEvent.click(
        screen.getByRole('radio', { name: LIBRARY_PAGE_COPY.coverSizes[COVER_SIZES.large] }),
      )
      expect(useWrenPrefs.getState().coverSize).toBe(COVER_SIZES.large)
      act(() => useWrenPrefs.getState().change({ coverSize: COVER_SIZES.medium }))
    })

    it('opens for an address naming a list the web has none of', async () => {
      renderWithProviders({
        ui: (
          <Routes>
            <Route element={<Collection />} path={WREN_ROUTES.collection} />
          </Routes>
        ),
        route: generatePath(WREN_ROUTES.collection, {
          [WREN_ROUTE_PARAMS.kind]: LIBRARY_SEGMENTS.downloads,
        }),
      })
      expect(
        await screen.findByRole('heading', { name: LIBRARY_PAGE_COPY.albums }),
      ).toBeInTheDocument()
    })
  })

  describe('the way back', () => {
    it('goes back to Library on the narrow layout, behind it or not', async () => {
      renderCollection({ kind: COLLECTION_KINDS.albums, formFactor: FORM_FACTORS.phone })
      await userEvent.click(screen.getByRole('button', { name: BACK }))
      expect(await screen.findByText(LIBRARY_MARK)).toBeInTheDocument()
    })

    it('goes back to the page behind it', async () => {
      renderCollection({
        kind: COLLECTION_KINDS.artists,
        formFactor: FORM_FACTORS.phone,
        isFromLibrary: true,
      })
      await userEvent.click(screen.getByRole('button', { name: BACK }))
      expect(await screen.findByText(LIBRARY_MARK)).toBeInTheDocument()
    })

    it("leaves the way back to the wide layout's sidebar", () => {
      renderCollection({ kind: COLLECTION_KINDS.albums })
      expect(screen.queryByRole('button', { name: BACK })).not.toBeInTheDocument()
    })
  })

  describe('Artists', () => {
    it('lays the artists out as cards with how many there are, each opening its page', async () => {
      renderCollection({ kind: COLLECTION_KINDS.artists })
      const card = await screen.findByRole('link', { name: RADIOHEAD.name })
      expect(card).toHaveAttribute('href', artistPath(RADIOHEAD.id))
      expect(card).toHaveTextContent(countsLineOf({ albums: 1, tracks: 3 }))
      expect(music().listArtists).toHaveBeenCalledWith({ libraryId: MUSIC.id, search: '' })
      expect(screen.getByText(plural({ n: 1, ...COUNTS_COPY.artists }))).toBeInTheDocument()
    })

    it('jumps to the first artist under a letter of the A to Z rail', async () => {
      const beck = { ...RADIOHEAD, id: 2, name: 'Beck', sortName: 'Beck' }
      music().listArtists.mockResolvedValue([beck, RADIOHEAD])
      renderCollection({ kind: COLLECTION_KINDS.artists })
      const radiohead = (await screen.findByRole('link', { name: RADIOHEAD.name })).closest('li')!
      const scrolled = spyOn(radiohead, 'scrollIntoView').mockImplementation(() => undefined)
      // No artist files under C, so the rail jumps to the next letter that has one.
      await userEvent.click(screen.getByRole('button', { name: LIBRARY_PAGE_COPY.jumpTo('C') }))
      expect(scrolled).toHaveBeenCalledTimes(1)
      expect(screen.getAllByRole('button', { name: /^Jump to / })).toHaveLength(LETTERS.length)
    })

    it('finds artists by what is typed, and drops the rail with nothing found', async () => {
      renderCollection({ kind: COLLECTION_KINDS.artists })
      await screen.findByRole('link', { name: RADIOHEAD.name })
      await userEvent.type(screen.getByLabelText(LIBRARY_PAGE_COPY.searchArtists), 'nobody')
      expect(await screen.findByText(LIBRARY_PAGE_COPY.noMatches)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: LIBRARY_PAGE_COPY.jumpTo('R') }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Unmatched albums', () => {
    it('lists the albums no release was found for, from the same listing as Albums', async () => {
      const unmatched = { ...OK_COMPUTER, id: 8, title: 'Kid A', match: MATCH_STATES.unmatched }
      music().listAlbums.mockResolvedValue([OK_COMPUTER, unmatched])
      renderCollection({ kind: COLLECTION_KINDS.unmatchedAlbums })
      expect(
        await screen.findByRole('link', {
          name: KIT_COPY.labelled({ label: unmatched.title, value: RADIOHEAD.name }),
        }),
      ).toHaveAttribute('href', albumPath(unmatched.id))
      expect(screen.queryByRole('link', { name: OK_COMPUTER_TILE })).not.toBeInTheDocument()
      expect(screen.getByText(plural({ n: 1, ...COUNTS_COPY.albums }))).toBeInTheDocument()
      expect(music().listAlbums).toHaveBeenCalledWith({
        libraryId: MUSIC.id,
        search: '',
        sort: MUSIC_SORTS.title,
      })
    })

    it('says every album is matched when none is unmatched, with no count', async () => {
      renderCollection({ kind: COLLECTION_KINDS.unmatchedAlbums })
      expect(await screen.findByText(LIBRARY_PAGE_COPY.noUnmatchedAlbums)).toBeInTheDocument()
      expect(screen.queryByText(plural({ n: 0, ...COUNTS_COPY.albums }))).not.toBeInTheDocument()
    })
  })

  describe('In progress, Favourites and Recently finished', () => {
    it('lists the songs left partway through as their albums keep them, and plays from one', async () => {
      renderCollection({ kind: COLLECTION_KINDS.inProgress })
      await userEvent.click(await screen.findByRole('button', { name: PARANOID.title }))
      expect(music().listInProgress).toHaveBeenCalledWith(MUSIC.id)
      expect(music().getAlbum).toHaveBeenCalledWith(OK_COMPUTER.id)
      expect(useAudioQueue.getState().queue.items).toHaveLength(1)
      expect(screen.getByText(plural({ n: 1, ...COUNTS_COPY.songs }))).toBeInTheDocument()
    })

    it('lists the favourite songs', async () => {
      renderCollection({ kind: COLLECTION_KINDS.favourites })
      expect(await screen.findByRole('button', { name: AIRBAG.title })).toBeInTheDocument()
      expect(music().listLibraryFavourites).toHaveBeenCalledWith(MUSIC.id)
    })

    it('lists the favourite artists above the favourite songs, each under its heading', async () => {
      music().listFavouriteArtists.mockResolvedValue([RADIOHEAD])
      renderCollection({ kind: COLLECTION_KINDS.favourites })
      expect(await screen.findByRole('button', { name: AIRBAG.title })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: new RegExp(RADIOHEAD.name) })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: LIBRARY_PAGE_COPY.artists })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: LIBRARY_PAGE_COPY.songs })).toBeInTheDocument()
    })

    it('lists a favourite artist when there are no favourite songs', async () => {
      music().listFavouriteArtists.mockResolvedValue([RADIOHEAD])
      music().listLibraryFavourites.mockResolvedValue([])
      renderCollection({ kind: COLLECTION_KINDS.favourites })
      expect(
        await screen.findByRole('link', { name: new RegExp(RADIOHEAD.name) }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: LIBRARY_PAGE_COPY.songs })).toBeNull()
      expect(screen.queryByText(LIBRARY_PAGE_COPY.noFavourites)).toBeNull()
    })

    it('lists the favourite albums as tiles under their heading', async () => {
      music().listFavouriteAlbums.mockResolvedValue([OK_COMPUTER])
      music().listLibraryFavourites.mockResolvedValue([])
      renderCollection({ kind: COLLECTION_KINDS.favourites })
      expect(await screen.findByRole('link', { name: OK_COMPUTER_TILE })).toHaveAttribute(
        'href',
        albumPath(OK_COMPUTER.id),
      )
      expect(screen.getByRole('heading', { name: LIBRARY_PAGE_COPY.albums })).toBeInTheDocument()
      expect(screen.queryByText(LIBRARY_PAGE_COPY.noFavourites)).toBeNull()
    })

    it('lists the songs played to their end, as many as raven shows', async () => {
      renderCollection({ kind: COLLECTION_KINDS.finished })
      expect(await screen.findByRole('button', { name: LUCKY.title })).toBeInTheDocument()
      expect(music().listHistory).toHaveBeenCalledWith({
        libraryId: MUSIC.id,
        limit: FINISHED_SHOWN,
        watchedOnly: true,
      })
    })

    it('says so when there is nothing to list, with no Play to press', async () => {
      music().listLibraryFavourites.mockResolvedValue([])
      renderCollection({ kind: COLLECTION_KINDS.favourites })
      expect(await screen.findByText(LIBRARY_PAGE_COPY.noFavourites)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: PLAYER_COPY.play })).not.toBeInTheDocument()
    })

    it('says the songs could not be read when raven does not answer', async () => {
      music().getAlbum.mockRejectedValue(new Error('refused'))
      renderCollection({ kind: COLLECTION_KINDS.inProgress })
      expect(await screen.findByText(LIBRARY_PAGE_COPY.failed)).toBeInTheDocument()
    })
  })

  describe('Songs', () => {
    const pages = () =>
      music().listTracks.mock.calls.filter(([props]) => props.limit === MUSIC_PAGE.most)

    it('lists the songs a page at a time, asking for the next page as the list nears its end', async () => {
      music().listTracks.mockImplementation(async ({ offset = 0 }) =>
        offset === 0
          ? { tracks: FIRST_PAGE, total: MUSIC_PAGE.most + 1 }
          : { tracks: [trackFor({ id: 9, title: 'Last song' })], total: MUSIC_PAGE.most + 1 },
      )
      renderCollection({ kind: COLLECTION_KINDS.songs })

      expect(await screen.findByRole('button', { name: 'Song 1' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: PLAYER_COPY.play })).toBeInTheDocument()
      expect(
        await screen.findByText(plural({ n: MUSIC_PAGE.most + 1, ...COUNTS_COPY.songs })),
      ).toBeInTheDocument()
      expect(pages()).toHaveLength(1)
      expect(music().listTracks).toHaveBeenCalledWith({
        libraryId: MUSIC.id,
        search: '',
        sort: MUSIC_SORTS.title,
        limit: MUSIC_PAGE.most,
        offset: 0,
        seed: 0,
      })

      await reachEnds()
      expect(await screen.findByRole('button', { name: 'Last song' })).toBeInTheDocument()
      expect(pages()).toHaveLength(2)
      expect(music().listTracks).toHaveBeenLastCalledWith({
        libraryId: MUSIC.id,
        search: '',
        sort: MUSIC_SORTS.title,
        limit: MUSIC_PAGE.most,
        offset: MUSIC_PAGE.most,
        seed: 0,
      })

      // Nothing is left to ask for once the last page is read.
      await reachEnds()
      expect(pages()).toHaveLength(2)
    })

    it('plays from the song pressed, and shuffles what is read', async () => {
      renderCollection({ kind: COLLECTION_KINDS.songs })
      await userEvent.click(await screen.findByRole('button', { name: 'Paranoid Android' }))
      expect(useAudioQueue.getState().queue.at).toBe(1)
      expect(useAudioQueue.getState().queue.items).toHaveLength(3)

      await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
      expect(useAudioQueue.getState().queue.isShuffled).toBe(true)
    })

    it('asks the server for the order picked', async () => {
      renderCollection({ kind: COLLECTION_KINDS.songs })
      await userEvent.click(
        await screen.findByRole('button', { name: sortButtonOf(MUSIC_SORTS.title) }),
      )
      await userEvent.click(
        await screen.findByRole('radio', { name: MUSIC_SORT_LABELS[MUSIC_SORTS.added] }),
      )
      await waitFor(() =>
        expect(music().listTracks).toHaveBeenCalledWith({
          libraryId: MUSIC.id,
          search: '',
          sort: MUSIC_SORTS.added,
          limit: MUSIC_PAGE.most,
          offset: 0,
          seed: expect.any(Number),
        }),
      )
    })

    it('says nothing matches a search that finds no song, with no Play to press', async () => {
      music().listTracks.mockImplementation(async ({ search = '' }) =>
        search === '' ? { tracks: FIRST_PAGE.slice(0, 2), total: 2 } : { tracks: [], total: 0 },
      )
      renderCollection({ kind: COLLECTION_KINDS.songs })
      await screen.findByRole('button', { name: 'Song 1' })
      await userEvent.type(screen.getByLabelText(LIBRARY_PAGE_COPY.searchSongs), 'zzz')
      expect(await screen.findByText(LIBRARY_PAGE_COPY.noMatches)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: PLAYER_COPY.play })).not.toBeInTheDocument()
    })
  })

  describe('Playlists', () => {
    it("lists the listener's playlists, each opening its page", async () => {
      renderCollection({ kind: COLLECTION_KINDS.playlists })
      expect(await screen.findByRole('link', { name: MIXTAPE.name })).toHaveAttribute(
        'href',
        playlistPath(MIXTAPE.id),
      )
      expect(screen.getByText(plural({ n: 1, ...COUNTS_COPY.playlists }))).toBeInTheDocument()
    })

    it('offers a first playlist when there is none, and makes it by name', async () => {
      music().listPlaylists.mockResolvedValue([])
      renderCollection({ kind: COLLECTION_KINDS.playlists })
      expect(
        await screen.findByRole('heading', { name: LIBRARY_PAGE_COPY.noPlaylists }),
      ).toBeInTheDocument()
      const [, emptyAction] = screen.getAllByRole('button', { name: NEW_PLAYLIST_COPY.title })
      await userEvent.click(emptyAction!)

      await userEvent.type(await screen.findByLabelText(NEW_PLAYLIST_COPY.name), ROAD_TRIP.name)
      await userEvent.click(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create }))
      expect(await screen.findByText(ROAD_TRIP_MARK)).toBeInTheDocument()
      expect(mocked().writes.createPlaylist).toHaveBeenCalledWith({ name: ROAD_TRIP.name })
      expect(useToast.getState().message).toBe(LIBRARY_PAGE_COPY.created(ROAD_TRIP.name))
    })

    it('says the playlists could not be read when raven does not answer', async () => {
      music().listPlaylists.mockRejectedValue(new Error('refused'))
      renderCollection({ kind: COLLECTION_KINDS.playlists })
      expect(await screen.findByText(LIBRARY_PAGE_COPY.failed)).toBeInTheDocument()
    })
  })
})
