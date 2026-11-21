import { describe, expect, it } from 'bun:test'
import { QUEUE_SOURCE_KINDS, artistNames } from '@raven/core'
import { DETAIL_COPY, KIT_COPY, PLAYER_COPY, PLAYLIST_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { generatePath } from 'react-router-dom'
import { AppRoutes } from '@/AppRoutes'
import { WREN_ROUTES, WREN_ROUTE_PARAMS, playlistPath } from '@/routes'
import { AIRBAG, LUCKY, MIXTAPE, MIXTAPE_PAGE, mockMusicApiEach, mockQueueEach } from '@/test/music'
import { renderWithProviders } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

const PLAYLIST_URL = playlistPath(MIXTAPE.id)

const SOURCE = { kind: QUEUE_SOURCE_KINDS.playlist, id: MIXTAPE.id }

const music = mockMusicApiEach()

type RenderPlaylistProps = { formFactor?: FormFactor }

/** The app on the playlist's page, once the playlist is read. */
const renderPlaylist = async ({ formFactor = FORM_FACTORS.phone }: RenderPlaylistProps = {}) => {
  renderWithProviders({ ui: <AppRoutes />, route: PLAYLIST_URL, formFactor })
  await screen.findByRole('heading', { level: 1, name: MIXTAPE.name })
}

describe('Playlist', () => {
  const { playTracks, playNext, addToQueue } = mockQueueEach()

  it("lists the playlist's tracks in its order, and plays it from the top or a track", async () => {
    await renderPlaylist()
    expect(screen.getByText('2 songs · 10 min')).toBeInTheDocument()
    const rows = screen.getAllByRole('button', { name: /^\d\. / })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['1. Lucky', '2. Airbag'])
    expect(rows[0]).toHaveTextContent(artistNames(LUCKY))

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.play }))
    expect(playTracks).toHaveBeenCalledWith({ tracks: MIXTAPE_PAGE.tracks, source: SOURCE })
    await userEvent.click(screen.getByRole('button', { name: '2. Airbag' }))
    expect(playTracks).toHaveBeenLastCalledWith({
      tracks: MIXTAPE_PAGE.tracks,
      startAt: 1,
      source: SOURCE,
    })

    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.shuffle }))
    expect(playTracks).toHaveBeenLastCalledWith({
      tracks: MIXTAPE_PAGE.tracks,
      source: SOURCE,
      isShuffled: true,
    })
  })

  it('queues the playlist, and says so', async () => {
    await renderPlaylist()
    await userEvent.click(screen.getByRole('button', { name: PLAYER_COPY.queue }))

    expect(addToQueue).toHaveBeenCalledWith(MIXTAPE_PAGE.tracks)
    expect(await screen.findByText(PLAYLIST_COPY.queued(MIXTAPE.name))).toBeInTheDocument()
  })

  it('plays the whole playlist next from its More sheet, which offers no playlist', async () => {
    await renderPlaylist()
    await userEvent.click(screen.getByRole('button', { name: DETAIL_COPY.more }))
    const sheet = screen.getByRole('dialog', { name: MIXTAPE.name })
    expect(within(sheet).queryByRole('button', { name: TRACK_MENU_COPY.addToPlaylist })).toBeNull()

    await userEvent.click(within(sheet).getByRole('button', { name: TRACK_MENU_COPY.playNext }))
    expect(playNext).toHaveBeenCalledWith(MIXTAPE_PAGE.tracks)
  })

  it("opens a track's own sheet from its More", async () => {
    await renderPlaylist()
    await userEvent.click(screen.getByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))

    expect(screen.getByRole('dialog', { name: AIRBAG.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: TRACK_MENU_COPY.goToAlbum })).toBeInTheDocument()
  })

  it('says when the playlist is empty, and offers nothing to play or queue', async () => {
    music().getPlaylist.mockResolvedValue({ playlist: { ...MIXTAPE, trackCount: 0 }, tracks: [] })
    await renderPlaylist()

    expect(screen.getByText(PLAYLIST_COPY.emptyTitle)).toBeInTheDocument()
    expect(screen.getByText(PLAYLIST_COPY.empty(MIXTAPE.name))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.play })).toBeNull()
    expect(screen.queryByRole('button', { name: PLAYER_COPY.queue })).toBeNull()
  })

  it('sets the head beside the tracklist from 48rem, More among its actions', async () => {
    await renderPlaylist({ formFactor: FORM_FACTORS.tablet })
    const page = within(screen.getByRole('main'))

    expect(page.queryByRole('navigation')).toBeNull()
    expect(page.getByRole('button', { name: DETAIL_COPY.more })).toBeInTheDocument()
    expect(page.getByText(DETAIL_COPY.columns.time)).toBeInTheDocument()
    expect(page.getByRole('button', { name: '1. Lucky' })).toBeInTheDocument()
  })

  it('says so when the playlist is not on the server', async () => {
    renderWithProviders({
      ui: <AppRoutes />,
      route: generatePath(WREN_ROUTES.playlist, { [WREN_ROUTE_PARAMS.id]: 'not-a-number' }),
    })

    expect(await screen.findByText(PLAYLIST_COPY.missing)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: KIT_COPY.backAlone })).toBeInTheDocument()
  })
})
