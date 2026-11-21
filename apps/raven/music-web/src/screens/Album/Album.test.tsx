import { describe, expect, it } from 'bun:test'
import { QUEUE_SOURCE_KINDS } from '@raven/core'
import {
  ALBUM_COPY,
  DETAIL_COPY,
  KIT_COPY,
  NEW_PLAYLIST_COPY,
  PLAYER_COPY,
  TRACK_MENU_COPY,
} from '@raven/wren'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { generatePath } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { WREN_ROUTES, WREN_ROUTE_PARAMS, albumPath } from '@/routes'
import {
  AIRBAG,
  COVER_VERSION,
  MIXTAPE,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  RADIOHEAD,
  ROAD_TRIP,
  mockMusicAndWritesEach,
  mockQueueEach,
} from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

const ALBUM_URL = albumPath(OK_COMPUTER.id)

const SOURCE = { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id }

const mixtapeRow = TRACK_MENU_COPY.playlistRow({ name: MIXTAPE.name, count: '2 songs' })

const mocked = mockMusicAndWritesEach()

type RenderAlbumProps = { formFactor?: FormFactor; route?: string }

/** The app on the album's page, once the album is read. */
const renderAlbum = async ({
  formFactor = FORM_FACTORS.phone,
  route = ALBUM_URL,
}: RenderAlbumProps = {}) => {
  renderWithProviders({ ui: <AppRoutes />, route, formFactor })
  await screen.findByRole('heading', { level: 1 })
}

const rows = () => screen.getAllByRole('button', { name: /^\d\. / })

/** Opens Airbag's sheet from its More, then Add to playlist. */
const openAddToPlaylist = async () => {
  await userEvent.click(screen.getByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))
  await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.addToPlaylist }))
  return screen.findByRole('list', { name: TRACK_MENU_COPY.pickPlaylist(AIRBAG.title) })
}

describe('Album', () => {
  const { playTracks, playNext, addToQueue } = mockQueueEach()

  it('lists the tracks under each disc in order, and plays the album from the top', async () => {
    await renderAlbum()

    expect(screen.getByRole('heading', { level: 1, name: OK_COMPUTER.title })).toBeInTheDocument()
    expect(screen.getByText('1997 · 3 songs · 15 min')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Disc 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Disc 2' })).toBeInTheDocument()
    expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual([
      '1. Airbag',
      '2. Paranoid Android',
      '3. Lucky',
    ])

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.play }))
    expect(playTracks).toHaveBeenCalledWith({ tracks: OK_COMPUTER_PAGE.tracks, source: SOURCE })
  })

  it('names no disc on an album of one', async () => {
    const [first, second] = OK_COMPUTER_PAGE.tracks
    mocked().music.getAlbum.mockResolvedValue({
      ...OK_COMPUTER_PAGE,
      discCount: 1,
      tracks: [first!, second!],
    })
    await renderAlbum()

    expect(rows()).toHaveLength(2)
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  it('plays from the track pressed, and shuffles the album', async () => {
    await renderAlbum()
    await userEvent.click(screen.getByRole('button', { name: '2. Paranoid Android' }))
    expect(playTracks).toHaveBeenCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      startAt: 1,
      source: SOURCE,
    })

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
    expect(playTracks).toHaveBeenLastCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      source: SOURCE,
      isShuffled: true,
    })
  })

  it('draws the cover the server has', async () => {
    mocked().music.getAlbum.mockResolvedValue({
      ...OK_COMPUTER_PAGE,
      album: { ...OK_COMPUTER, coverVersion: COVER_VERSION },
    })
    const { container } = renderWithProviders({ ui: <AppRoutes />, route: ALBUM_URL })
    await screen.findByRole('heading', { level: 1, name: OK_COMPUTER.title })

    expect(container.querySelector('main img')?.getAttribute('src') ?? '').toContain(COVER_VERSION)
  })

  it('opens the artist from their name under the title', async () => {
    await renderAlbum()
    const link = screen.getByRole('link', { name: ALBUM_COPY.openArtist(RADIOHEAD.name) })
    expect(link).toHaveTextContent(RADIOHEAD.name)

    await userEvent.click(link)
    expect(
      await screen.findByRole('heading', { level: 1, name: RADIOHEAD.name }),
    ).toBeInTheDocument()
  })

  it("puts a row's track next or at the end of the queue from its sheet", async () => {
    await renderAlbum()

    fireEvent.contextMenu(screen.getByRole('button', { name: '1. Airbag' }))
    expect(screen.getByText(`${RADIOHEAD.name} · ${OK_COMPUTER.title}`)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.playNext }))
    expect(playNext).toHaveBeenCalledWith([AIRBAG])

    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.addToQueue }))
    expect(addToQueue).toHaveBeenCalledWith([AIRBAG])
  })

  it("goes to a track's artist from its sheet", async () => {
    await renderAlbum()
    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.goToArtist }))

    expect(
      await screen.findByRole('heading', { level: 1, name: RADIOHEAD.name }),
    ).toBeInTheDocument()
  })

  it('adds a track to a playlist, and says so in a toast', async () => {
    await renderAlbum()
    const picker = await openAddToPlaylist()
    await userEvent.click(within(picker).getByRole('button', { name: mixtapeRow }))

    expect(await screen.findByText(TRACK_MENU_COPY.added(MIXTAPE.name))).toBeInTheDocument()
    expect(mocked().writes.appendPlaylistTracks).toHaveBeenCalledWith({
      id: MIXTAPE.id,
      mediaIds: [AIRBAG.id],
    })
  })

  it('shows why adding a track to a playlist was refused', async () => {
    mocked().writes.appendPlaylistTracks.mockRejectedValueOnce(new Error('Playlist is full.'))
    await renderAlbum()
    const picker = await openAddToPlaylist()
    await userEvent.click(within(picker).getByRole('button', { name: mixtapeRow }))

    expect(await screen.findByText('Playlist is full.')).toBeInTheDocument()
    expect(screen.queryByText(TRACK_MENU_COPY.added(MIXTAPE.name))).toBeNull()
  })

  it('makes a new playlist in the sheet and puts the track in it', async () => {
    mocked().music.listPlaylists.mockResolvedValue([])
    await renderAlbum()
    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.addToPlaylist }))
    expect(await screen.findByText(TRACK_MENU_COPY.noPlaylists)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.title }))
    await userEvent.type(screen.getByLabelText(NEW_PLAYLIST_COPY.name), ROAD_TRIP.name)
    await userEvent.click(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create }))

    expect(await screen.findByText(TRACK_MENU_COPY.added(ROAD_TRIP.name))).toBeInTheDocument()
    expect(mocked().writes.createPlaylist).toHaveBeenCalledWith({ name: ROAD_TRIP.name })
    expect(mocked().writes.appendPlaylistTracks).toHaveBeenCalledWith({
      id: ROAD_TRIP.id,
      mediaIds: [AIRBAG.id],
    })
  })

  it('likes the album, and queues it', async () => {
    await renderAlbum()
    await userEvent.click(screen.getByRole('switch', { name: PLAYER_COPY.like }))
    expect(mocked().writes.setAlbumFavourite).toHaveBeenCalledWith({
      albumId: OK_COMPUTER.id,
      favourite: true,
    })

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.queue }))
    expect(addToQueue).toHaveBeenCalledWith(OK_COMPUTER_PAGE.tracks)
    expect(await screen.findByText(ALBUM_COPY.queued(OK_COMPUTER.title))).toBeInTheDocument()
  })

  it('says why a like was refused', async () => {
    mocked().writes.setAlbumFavourite.mockRejectedValueOnce(new Error('raven is out of reach.'))
    await renderAlbum()
    await userEvent.click(screen.getByRole('switch', { name: PLAYER_COPY.like }))

    expect(await screen.findByText('raven is out of reach.')).toBeInTheDocument()
  })

  it('plays the whole album next, or adds it to a playlist, from its More sheet', async () => {
    await renderAlbum()
    await userEvent.click(screen.getByRole('button', { name: DETAIL_COPY.more }))
    expect(screen.getByRole('dialog', { name: OK_COMPUTER.title })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.playNext }))
    expect(playNext).toHaveBeenCalledWith(OK_COMPUTER_PAGE.tracks)

    await userEvent.click(screen.getByRole('button', { name: DETAIL_COPY.more }))
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.addToPlaylist }))
    const picker = await screen.findByRole('list', {
      name: TRACK_MENU_COPY.pickPlaylist(OK_COMPUTER.title),
    })
    await userEvent.click(within(picker).getByRole('button', { name: mixtapeRow }))
    expect(await screen.findByText(TRACK_MENU_COPY.added(MIXTAPE.name))).toBeInTheDocument()
    expect(mocked().writes.appendPlaylistTracks).toHaveBeenCalledWith({
      id: MIXTAPE.id,
      mediaIds: OK_COMPUTER_PAGE.tracks.map((track) => track.id),
    })
  })

  it('sets back and More in a nav bar over the head under 48rem', async () => {
    await renderAlbum({ formFactor: FORM_FACTORS.phone })
    const bar = within(screen.getByRole('main')).getByRole('navigation')

    expect(within(bar).getByRole('button', { name: KIT_COPY.backAlone })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: DETAIL_COPY.more })).toBeInTheDocument()
  })

  it('sets the head beside the tracklist from 48rem, More among its actions', async () => {
    await renderAlbum({ formFactor: FORM_FACTORS.tablet })
    const page = within(screen.getByRole('main'))

    expect(page.queryByRole('navigation')).toBeNull()
    expect(page.getByRole('button', { name: KIT_COPY.backAlone })).toHaveTextContent(
      KIT_COPY.backAlone,
    )
    expect(page.getByRole('button', { name: DETAIL_COPY.more })).toBeInTheDocument()
    expect(page.getByText(DETAIL_COPY.columns.title)).toBeInTheDocument()
    expect(page.getByRole('button', { name: '1. Airbag' })).toBeInTheDocument()
  })

  it('goes back to Library when the page was opened by its address', async () => {
    await renderAlbum()
    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.backAlone }))

    expect(await screen.findByRole('link', { current: 'page' })).toHaveAttribute(
      'href',
      WREN_ROUTES.library,
    )
  })

  it('says the album is opening while it is read, with the way back', async () => {
    mocked().music.getAlbum.mockReturnValue(new Promise(() => undefined))
    renderWithProviders({ ui: <AppRoutes />, route: ALBUM_URL })

    expect(await screen.findByText(ALBUM_COPY.opening)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: KIT_COPY.backAlone })).toBeInTheDocument()
  })

  it('says why the album could not be read', async () => {
    mocked().music.getAlbum.mockRejectedValue(new Error('raven is out of reach.'))
    renderWithProviders({ ui: <AppRoutes />, route: ALBUM_URL })

    expect(await screen.findByText('raven is out of reach.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: KIT_COPY.backAlone })).toBeInTheDocument()
  })

  it('says so when the album is not on the server', async () => {
    renderWithProviders({
      ui: <AppRoutes />,
      route: generatePath(WREN_ROUTES.album, { [WREN_ROUTE_PARAMS.id]: 'not-a-number' }),
    })

    expect(await screen.findByText(ALBUM_COPY.missing)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: KIT_COPY.backAlone })).toBeInTheDocument()
  })
})
