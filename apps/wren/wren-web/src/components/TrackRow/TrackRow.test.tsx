import { describe, expect, it, mock, spyOn } from 'bun:test'
import { KIT_COPY, SONG_LEADS, TRACK_MENU_COPY } from '@raven/wren'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { TrackRow } from '@/components/TrackRow/TrackRow'
import { api } from '@/lib/api'
import { WREN_ROUTES } from '@/routes'
import { AIRBAG, OK_COMPUTER, RADIOHEAD, mockMusicApiEach, mockQueueEach } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const ROW = '1. Airbag'

const ARTIST_PAGE = 'the artist page'

type RenderRowProps = { isCurrent?: boolean }

const renderRow = ({ isCurrent = false }: RenderRowProps = {}) => {
  const onPress = mock()
  const row = (
    <TrackRow
      isCurrent={isCurrent}
      label={ROW}
      lead={{ kind: SONG_LEADS.number, number: '1' }}
      length="5:00"
      onPress={onPress}
      track={AIRBAG}
    />
  )
  renderWithProviders({
    ui: (
      <Routes>
        <Route element={row} path={WREN_ROUTES.home} />
        <Route element={<p>{ARTIST_PAGE}</p>} path={WREN_ROUTES.artist} />
      </Routes>
    ),
  })
  return { onPress }
}

const openMenu = () =>
  userEvent.click(screen.getByRole('button', { name: KIT_COPY.more(AIRBAG.title) }))

const menu = () => screen.getByRole('dialog', { name: AIRBAG.title })

describe('TrackRow', () => {
  mockMusicApiEach()
  const { playNext, addToQueue } = mockQueueEach()

  it('plays on a press, and shows its title and length', async () => {
    const { onPress } = renderRow()
    const row = screen.getByRole('button', { name: ROW })
    expect(row).toHaveTextContent(AIRBAG.title)
    expect(row).toHaveTextContent('5:00')

    await userEvent.click(row)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marks the track the queue is on', () => {
    renderRow({ isCurrent: true })
    expect(screen.getByRole('button', { name: ROW })).toHaveAttribute('aria-current', 'true')
  })

  it('opens its sheet from More, named for the track over its artists and album', async () => {
    renderRow()
    await openMenu()

    expect(within(menu()).getByText(`${RADIOHEAD.name} · ${OK_COMPUTER.title}`)).toBeInTheDocument()
    expect(
      within(menu())
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      TRACK_MENU_COPY.unlike,
      TRACK_MENU_COPY.playNext,
      TRACK_MENU_COPY.addToQueue,
      TRACK_MENU_COPY.addToPlaylist,
      TRACK_MENU_COPY.goToAlbum,
      TRACK_MENU_COPY.goToArtist,
    ])
  })

  it('turns the song off as a favourite from its heart', async () => {
    const setFavourite = spyOn(api, 'setFavourite').mockImplementation(
      () => new Promise(() => undefined),
    )
    renderRow()
    const heart = await screen.findByRole('button', {
      name: TRACK_MENU_COPY.likeSong(AIRBAG.title),
      pressed: true,
    })
    await userEvent.click(heart)
    expect(setFavourite).toHaveBeenCalledWith({ id: AIRBAG.id, favourite: false })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    setFavourite.mockRestore()
  })

  it('opens its sheet on a right click or the context menu key, in place of the browser menu', () => {
    renderRow()
    const wasLeftToBrowser = fireEvent.contextMenu(screen.getByRole('button', { name: ROW }))

    expect(wasLeftToBrowser).toBe(false)
    expect(menu()).toBeInTheDocument()
  })

  it('puts the track next, or at the end of the queue, and closes', async () => {
    renderRow()
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.playNext }))
    expect(playNext).toHaveBeenCalledWith([AIRBAG])
    expect(screen.queryByRole('dialog')).toBeNull()

    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.addToQueue }))
    expect(addToQueue).toHaveBeenCalledWith([AIRBAG])
  })

  it('goes to its artist', async () => {
    renderRow()
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.goToArtist }))
    expect(screen.getByText(ARTIST_PAGE)).toBeInTheDocument()
  })

  it('swaps the same sheet to Add to playlist, and closes from Close', async () => {
    renderRow()
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: TRACK_MENU_COPY.addToPlaylist }))

    const picker = screen.getByRole('dialog', { name: TRACK_MENU_COPY.addToPlaylistTitle })
    expect(
      await within(picker).findByRole('list', {
        name: TRACK_MENU_COPY.pickPlaylist(AIRBAG.title),
      }),
    ).toBeInTheDocument()

    const [, close] = within(picker).getAllByRole('button', { name: KIT_COPY.close })
    await userEvent.click(close!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
