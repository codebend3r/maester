import { afterEach, describe, expect, it, jest, mock } from 'bun:test'
import { TOUCH_HOLD_DELAY_MS, artistNames } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { COVER_FACT_LABELS, PLAYER_COPY, SONG_LEADS, TRACK_MENU_COPY } from '@raven/wren'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { TrackRow } from '@/components/TrackRow/TrackRow'
import { useCovers } from '@/music/useCovers'
import { PlayerCover } from '@/screens/NowPlaying/PlayerCover'
import { NowPlayingBar } from '@/shell/NowPlayingBar/NowPlayingBar'
import { AIRBAG, OK_COMPUTER, OK_COMPUTER_TILE, mockMusicApiEach } from '@/test/music'
import { KIT_PAGES, renderKitWithRoutes } from '@/test/render'
import { AlbumTileOf } from '@/ui/AlbumTile/AlbumTile'

const TOUCH = { pointerType: 'touch', clientX: 10, clientY: 10 } as const

type HoldProps = { cover: Element | null }

/** A finger resting on the cover until it holds, then lifting. */
const hold = ({ cover }: HoldProps) => {
  if (cover === null) throw new Error('there is a cover to hold')
  jest.useFakeTimers()
  fireEvent.pointerDown(cover, TOUCH)
  act(() => {
    jest.advanceTimersByTime(TOUCH_HOLD_DELAY_MS)
  })
  fireEvent.pointerUp(cover, TOUCH)
  fireEvent.click(cover)
  jest.useRealTimers()
}

const menuOf = (title: string) => screen.getByRole('dialog', { name: title })

type FactProps = { menu: HTMLElement; label: string; value: string }

const expectFact = ({ menu, label, value }: FactProps) => {
  expect(within(menu).getByText(label)).toBeInTheDocument()
  expect(within(menu).getByText(value)).toBeInTheDocument()
}

describe('the menu a held cover opens', () => {
  mockMusicApiEach()

  afterEach(() => {
    jest.useRealTimers()
    useAudioQueue.getState().clear()
  })

  it("opens from an album tile's cover in the tile's place, saying what the album is", async () => {
    renderKitWithRoutes(<AlbumTileOf album={OK_COMPUTER} coverOf={useCovers().coverOf} />)
    const tile = screen.getByRole('link', { name: OK_COMPUTER_TILE })

    hold({ cover: tile.firstElementChild })

    expect(screen.queryByText(KIT_PAGES.album)).toBeNull()
    const menu = menuOf(OK_COMPUTER.title)
    expect(within(menu).getByText(artistNames(OK_COMPUTER))).toBeInTheDocument()
    expectFact({ menu, label: COVER_FACT_LABELS.released, value: '1997' })
    expectFact({ menu, label: COVER_FACT_LABELS.tracks, value: '3' })
    expectFact({ menu, label: COVER_FACT_LABELS.length, value: '15 min' })
    expect(await within(menu).findByText('FLAC · 16-bit / 44.1 kHz')).toBeInTheDocument()
  })

  it("goes to the album's artist from the album's menu", () => {
    renderKitWithRoutes(<AlbumTileOf album={OK_COMPUTER} coverOf={useCovers().coverOf} />)
    hold({ cover: screen.getByRole('link', { name: OK_COMPUTER_TILE }).firstElementChild })

    fireEvent.click(
      within(menuOf(OK_COMPUTER.title)).getByRole('button', { name: TRACK_MENU_COPY.goToArtist }),
    )

    expect(screen.getByText(KIT_PAGES.artist)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on a right click on the cover too', () => {
    renderKitWithRoutes(<AlbumTileOf album={OK_COMPUTER} coverOf={useCovers().coverOf} />)
    const cover = screen.getByRole('link', { name: OK_COMPUTER_TILE }).firstElementChild

    if (cover !== null) fireEvent.contextMenu(cover)

    expect(menuOf(OK_COMPUTER.title)).toBeInTheDocument()
  })

  // happy-dom ignores `pointer-events`, so the veil letting a touch through is the e2e's to show.
  it("opens from the playing row's art, under the equalizer's veil", () => {
    renderKitWithRoutes(
      <TrackRow
        isCurrent
        label={AIRBAG.title}
        lead={{ kind: SONG_LEADS.art, cover: null }}
        length="5:00"
        onPress={mock()}
        track={AIRBAG}
      />,
    )
    const lead = screen.getByRole('button', { name: AIRBAG.title }).firstElementChild

    hold({ cover: lead?.firstElementChild ?? null })

    expect(menuOf(AIRBAG.title)).toBeInTheDocument()
  })

  it("opens from a song row's art about the song, without playing it or opening its own menu", async () => {
    const onPress = mock()
    renderKitWithRoutes(
      <TrackRow
        isCurrent={false}
        label={AIRBAG.title}
        lead={{ kind: SONG_LEADS.art, cover: null }}
        length="5:00"
        onPress={onPress}
        track={AIRBAG}
      />,
    )

    hold({ cover: screen.getByRole('button', { name: AIRBAG.title }).firstElementChild })

    expect(onPress).not.toHaveBeenCalled()
    const menu = menuOf(AIRBAG.title)
    expect(within(menu).queryByText(TRACK_MENU_COPY.playNext)).toBeNull()
    expectFact({ menu, label: COVER_FACT_LABELS.album, value: OK_COMPUTER.title })
    expectFact({
      menu,
      label: COVER_FACT_LABELS.format,
      value: 'FLAC · 16-bit / 44.1 kHz · 900 kbps',
    })
    expect(await within(menu).findByText('1997')).toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('button', { name: TRACK_MENU_COPY.goToAlbum }))

    expect(screen.getByText(KIT_PAGES.album)).toBeInTheDocument()
  })

  it("opens from the mini player's cover about the playing song, without opening Now Playing", () => {
    act(() => useAudioQueue.getState().playTracks({ tracks: [AIRBAG] }))
    renderKitWithRoutes(<NowPlayingBar />)
    const open = screen.getByRole('button', {
      name: PLAYER_COPY.open({ title: AIRBAG.title, artists: artistNames(AIRBAG) }),
    })

    hold({ cover: open.firstElementChild })

    expect(menuOf(AIRBAG.title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: TRACK_MENU_COPY.goToArtist })).toBeInTheDocument()
  })

  it("opens from Now Playing's cover, even with no picture to show", () => {
    const { container } = renderKitWithRoutes(
      <PlayerCover className="cover" cover={null} track={AIRBAG} />,
    )

    hold({ cover: container.firstElementChild?.firstElementChild ?? null })

    fireEvent.click(
      within(menuOf(AIRBAG.title)).getByRole('button', { name: TRACK_MENU_COPY.goToArtist }),
    )
    expect(screen.getByText(KIT_PAGES.artist)).toBeInTheDocument()
  })
})
