import { describe, expect, it, mock } from 'bun:test'
import type { Track } from '@raven/core'
import { NEW_PLAYLIST_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddToPlaylist } from '@/components/AddToPlaylist/AddToPlaylist'
import { useToast } from '@/stores/toast'
import { AIRBAG, MIXTAPE, ROAD_TRIP, mockMusicAndWritesEach } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const mixtapeRow = TRACK_MENU_COPY.playlistRow({ name: MIXTAPE.name, count: '2 songs' })

const mocked = mockMusicAndWritesEach()

const renderPicker = () => {
  const onDone = mock()
  const tracksOf = mock(async (): Promise<readonly Track[]> => [AIRBAG])
  renderWithProviders({
    ui: <AddToPlaylist name={AIRBAG.title} onDone={onDone} tracksOf={tracksOf} />,
  })
  return { onDone, tracksOf }
}

const playlists = () =>
  screen.findByRole('list', { name: TRACK_MENU_COPY.pickPlaylist(AIRBAG.title) })

describe('AddToPlaylist', () => {
  it('adds the tracks to the playlist pressed, closes, and says where they went', async () => {
    const { onDone } = renderPicker()
    await userEvent.click(within(await playlists()).getByRole('button', { name: mixtapeRow }))

    expect(onDone).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(useToast.getState().message).toBe(TRACK_MENU_COPY.added(MIXTAPE.name)),
    )
    expect(mocked().writes.appendPlaylistTracks).toHaveBeenCalledWith({
      id: MIXTAPE.id,
      mediaIds: [AIRBAG.id],
    })
  })

  it('says why the server refused', async () => {
    mocked().writes.appendPlaylistTracks.mockRejectedValueOnce(new Error('Playlist is full.'))
    renderPicker()
    await userEvent.click(within(await playlists()).getByRole('button', { name: mixtapeRow }))

    await waitFor(() => expect(useToast.getState().message).toBe('Playlist is full.'))
  })

  it('says so while there are no playlists, and makes one that takes the tracks', async () => {
    mocked().music.listPlaylists.mockResolvedValue([])
    const { onDone } = renderPicker()
    expect(await screen.findByText(TRACK_MENU_COPY.noPlaylists)).toBeInTheDocument()
    expect(screen.getByText(TRACK_MENU_COPY.noPlaylistsHint(AIRBAG.title))).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.title }))
    await userEvent.type(screen.getByLabelText(NEW_PLAYLIST_COPY.name), ROAD_TRIP.name)
    await userEvent.click(screen.getByRole('button', { name: NEW_PLAYLIST_COPY.create }))

    await waitFor(() =>
      expect(useToast.getState().message).toBe(TRACK_MENU_COPY.added(ROAD_TRIP.name)),
    )
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(mocked().writes.createPlaylist).toHaveBeenCalledWith({ name: ROAD_TRIP.name })
    expect(mocked().writes.appendPlaylistTracks).toHaveBeenCalledWith({
      id: ROAD_TRIP.id,
      mediaIds: [AIRBAG.id],
    })
  })

  it("offers only the listener's own playlists, not another account's shared one", async () => {
    const theirs = {
      ...MIXTAPE,
      id: MIXTAPE.id + 1,
      name: 'Their mix',
      isShared: true,
      isOwn: false,
    }
    mocked().music.listPlaylists.mockResolvedValue([MIXTAPE, theirs])
    renderPicker()

    const list = await playlists()
    expect(within(list).getByRole('button', { name: mixtapeRow })).toBeInTheDocument()
    expect(within(list).queryByText(theirs.name)).toBeNull()
  })

  it('says the playlists are loading, then why they could not be read', async () => {
    mocked().music.listPlaylists.mockRejectedValue(new Error('raven is out of reach.'))
    renderPicker()

    expect(screen.getByText(TRACK_MENU_COPY.loading)).toBeInTheDocument()
    expect(await screen.findByText('raven is out of reach.')).toBeInTheDocument()
  })
})
