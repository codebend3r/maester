import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { MUSIC_FACT_LABELS, MUSIC_LINK_COPY, TOUCH_HOLD_DELAY_MS } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { AlbumCard } from '@/components/AlbumGrid/AlbumGrid'
import { MUSIC_MENU_COPY } from '@/components/MusicMenu/copy'
import { NowPlayingBar } from '@/components/NowPlayingBar/NowPlayingBar'
import { NOW_PLAYING_BAR_COPY } from '@/components/NowPlayingBar/copy'
import { api } from '@/lib/api'
import { album, albumDetails, track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

/** Where the page is, so a test sees a link taken. */
const Where = () => <output data-testid="where">{useLocation().pathname}</output>

/** Holds a finger on the cover for the hold's delay, then lets the timers run as normal again. */
const hold = (cover: Element) => {
  fireEvent.pointerDown(cover, { pointerType: 'touch', clientX: 5, clientY: 5 })
  act(() => jest.advanceTimersByTime(TOUCH_HOLD_DELAY_MS))
  fireEvent.pointerUp(cover, { pointerType: 'touch' })
  jest.useRealTimers()
}

/** The menu's fact, as a name and its value. */
const factOf = (label: string): string | null =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent ?? null

beforeEach(() => {
  jest.useFakeTimers()
  spyOn(api, 'getAlbum').mockResolvedValue(
    albumDetails({ album: album({ releaseDate: '1997-05-21' }) }),
  )
})

afterEach(() => {
  cleanup()
  jest.useRealTimers()
  jest.restoreAllMocks()
  useAudioQueue.getState().clear()
})

const OK_COMPUTER = album({ plays: 4 })

const mountCard = () => {
  const view = renderWithProviders({
    ui: (
      <>
        <ul>
          <AlbumCard album={OK_COMPUTER} />
        </ul>
        <Where />
      </>
    ),
  })
  const [cover] = view.container.querySelectorAll('li > a')
  if (cover === undefined) throw new Error('the card drew no cover')
  return cover
}

describe("an album cover's long press", () => {
  it('tells of the album, its genres and label once its page is read, and takes no click', async () => {
    const cover = mountCard()
    hold(cover)
    fireEvent.click(cover)
    const dialog = await screen.findByRole('dialog', { name: OK_COMPUTER.title })
    expect(screen.getByTestId('where')).toHaveTextContent('/')
    expect(factOf(MUSIC_FACT_LABELS.artists)).toBe('Radiohead')
    expect(factOf(MUSIC_FACT_LABELS.released)).toBe('1997')
    expect(factOf(MUSIC_FACT_LABELS.tracks)).toBe('2 tracks')
    expect(factOf(MUSIC_FACT_LABELS.length)).toBe('6:40')
    expect(factOf(MUSIC_FACT_LABELS.plays)).toBe('4 plays')
    expect(await within(dialog).findByText('Parlophone')).toBeTruthy()
    expect(factOf(MUSIC_FACT_LABELS.genres)).toBe('Alternative Rock')
  })

  it('goes to the album, and closes', async () => {
    const cover = mountCard()
    hold(cover)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('link', { name: MUSIC_LINK_COPY.goToAlbum }))
    expect(screen.getByTestId('where')).toHaveTextContent('/albums/7')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('marks the album a favourite once its page says it is not one', async () => {
    const setFavourite = spyOn(api, 'setAlbumFavourite').mockResolvedValue(
      albumDetails({ album: OK_COMPUTER }),
    )
    const cover = mountCard()
    hold(cover)
    await screen.findByRole('dialog')
    fireEvent.click(await screen.findByRole('button', { name: MUSIC_MENU_COPY.addFavourite }))
    await waitFor(() =>
      expect(setFavourite).toHaveBeenCalledWith({ albumId: OK_COMPUTER.id, favourite: true }),
    )
  })

  it('goes to its artist', async () => {
    const cover = mountCard()
    hold(cover)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('link', { name: MUSIC_LINK_COPY.goToArtist }))
    expect(screen.getByTestId('where')).toHaveTextContent('/artists/1')
  })

  it("opens on a mouse's right click, in the browser's menu's place", async () => {
    const cover = mountCard()
    fireEvent.pointerDown(cover, { pointerType: 'mouse', button: 2 })
    const menu = createEvent.contextMenu(cover)
    fireEvent(cover, menu)
    expect(menu.defaultPrevented).toBe(true)
    expect(await screen.findByRole('dialog', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(screen.getByTestId('where')).toHaveTextContent('/')
  })

  it("never holds a mouse's press, which stays the link's click", () => {
    const cover = mountCard()
    fireEvent.pointerDown(cover, { pointerType: 'mouse' })
    act(() => jest.advanceTimersByTime(TOUCH_HOLD_DELAY_MS * 2))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(cover)
    expect(screen.getByTestId('where')).toHaveTextContent('/albums/7')
  })
})

describe("the playing track's cover", () => {
  it('tells of the track and its album, and goes to either', async () => {
    useAudioQueue.getState().playTracks({ tracks: [track({ duration: 284 })] })
    renderWithProviders({
      ui: (
        <>
          <NowPlayingBar />
          <Where />
        </>
      ),
      route: '/music/albums',
    })
    const bar = within(screen.getByRole('region', { name: NOW_PLAYING_BAR_COPY.miniPlayer }))
    const cover = bar.getByRole('link', { name: NOW_PLAYING_BAR_COPY.nowPlaying })
    hold(cover)
    fireEvent.click(cover)
    await screen.findByRole('dialog', { name: 'Airbag' })
    expect(screen.getByTestId('where')).toHaveTextContent('/music/albums')
    expect(factOf(MUSIC_FACT_LABELS.album)).toBe('OK Computer')
    expect(factOf(MUSIC_FACT_LABELS.length)).toBe('4:44')
    expect(await screen.findByText('May 21, 1997')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: MUSIC_LINK_COPY.goToArtist }))
    expect(screen.getByTestId('where')).toHaveTextContent('/music/artists/1')
  })
})
