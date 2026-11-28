import { describe, expect, it, mock } from 'bun:test'
import type { Track } from '@raven/core'
import { TRACK_MENU_COPY } from '@raven/wren'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { TracksMenu } from '@/components/TrackMenu/TrackMenu'
import { WREN_ROUTES } from '@/routes'
import { useToast } from '@/stores/toast'
import {
  MIXTAPE,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  RADIOHEAD,
  mockMusicApiEach,
  mockQueueEach,
} from '@/test/music'
import { renderWithProviders } from '@/test/render'

const ARTIST_PAGE = 'the artist page'

type RenderMenuProps = {
  canAddToPlaylist?: boolean
  tracksOf?: () => Promise<readonly Track[]>
}

const renderMenu = ({
  canAddToPlaylist = false,
  tracksOf = async () => OK_COMPUTER_PAGE.tracks,
}: RenderMenuProps = {}) => {
  const onClose = mock()
  const sheet = (
    <TracksMenu
      canAddToPlaylist={canAddToPlaylist}
      head={{ title: OK_COMPUTER.title, subtitle: RADIOHEAD.name }}
      onClose={onClose}
      places={{ artists: OK_COMPUTER.artists }}
      tracksOf={tracksOf}
    />
  )
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={sheet} path={WREN_ROUTES.home} />
        <Route element={<p>{ARTIST_PAGE}</p>} path={WREN_ROUTES.artist} />
      </Routes>
    ),
  })
  return { onClose }
}

const actions = () =>
  within(screen.getByRole('dialog'))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

describe('TracksMenu', () => {
  mockMusicApiEach()
  const { playNext, addToQueue } = mockQueueEach()

  it('offers the queue and only the places it was given, with no Add to playlist unless asked', () => {
    renderMenu()
    expect(screen.getByRole('dialog', { name: OK_COMPUTER.title })).toBeInTheDocument()
    expect(actions()).toEqual([
      TRACK_MENU_COPY.playNext,
      TRACK_MENU_COPY.addToQueue,
      TRACK_MENU_COPY.goToArtist,
    ])
  })

  it('reads its tracks only once an action needs them, and closes first', async () => {
    const tracksOf = mock(async (): Promise<readonly Track[]> => OK_COMPUTER_PAGE.tracks)
    const { onClose } = renderMenu({ tracksOf })
    expect(tracksOf).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.addToQueue }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(addToQueue).toHaveBeenCalledWith(OK_COMPUTER_PAGE.tracks))
  })

  it('says why its tracks could not be read', async () => {
    renderMenu({ tracksOf: () => Promise.reject(new Error('raven is out of reach.')) })
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.playNext }))

    await waitFor(() => expect(useToast.getState().message).toBe('raven is out of reach.'))
    expect(playNext).not.toHaveBeenCalled()
  })

  it("shows the listener's playlists in the same sheet from Add to playlist, staying open", async () => {
    const { onClose } = renderMenu({ canAddToPlaylist: true })
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.addToPlaylist }))

    const picker = screen.getByRole('dialog', { name: TRACK_MENU_COPY.addToPlaylistTitle })
    expect(within(picker).getByText(`${OK_COMPUTER.title} · ${RADIOHEAD.name}`)).toBeInTheDocument()
    const playlists = await within(picker).findByRole('list', {
      name: TRACK_MENU_COPY.pickPlaylist(OK_COMPUTER.title),
    })
    expect(within(playlists).getByText(MIXTAPE.name)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: TRACK_MENU_COPY.addToQueue })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('goes to the artist, closing on the way', async () => {
    const { onClose } = renderMenu()
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.goToArtist }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText(ARTIST_PAGE)).toBeInTheDocument()
  })
})
