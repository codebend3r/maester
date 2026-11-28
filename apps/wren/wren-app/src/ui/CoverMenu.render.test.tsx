import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { artistNames } from '@raven/core'
import type * as Native from '@raven/native'
import { useAudioQueue } from '@raven/ui/headless'
import {
  COVER_FACT_LABELS,
  COVER_MENU_COPY,
  KIT_COPY,
  LIBRARY_SEGMENTS,
  TRACK_MENU_COPY,
} from '@raven/wren'
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_PAGES, WREN_ROUTES, collectionPathOf } from '@raven/wren-native/headless'
import { AIRBAG, LISTENER, OK_COMPUTER, RADIOHEAD, musicApi } from '@raven/wren-native/testing'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'
import { HELD_COVER_TEST_ID } from '@/ui/HeldArt'

const mockApi = musicApi()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  // jest has no NetInfo native module to ask; the device is on Wi-Fi.
  isOnCellular: async () => false,
  apiFor: () => mockApi,
  watchNetwork: () => () => undefined,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const ALBUM_TILE = KIT_COPY.labelled({ label: OK_COMPUTER.title, value: artistNames(OK_COMPUTER) })

const MINI_PLAYER = `Now Playing: ${AIRBAG.title}, ${artistNames(AIRBAG)}`

// The screen reader's long press, as VoiceOver and TalkBack send it.
const SCREEN_READER_HOLD = { nativeEvent: { actionName: 'longpress' } }

const albumTile = async () => (await screen.findAllByRole('button', { name: ALBUM_TILE })).at(-1)!

type FactProps = { label: string; value: string }

const expectFact = ({ label, value }: FactProps) =>
  expect(screen.getByLabelText(KIT_COPY.labelled({ label, value }))).toBeTruthy()

describe('the menu a held cover opens', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.getState().clear()
  })

  it("opens from an album tile's cover in place of the album, and goes to its artist", async () => {
    const router = await renderRouter(WREN_TREE, {
      initialUrl: collectionPathOf(LIBRARY_SEGMENTS.albums),
    })

    await fireEvent(within(await albumTile()).getByTestId(HELD_COVER_TEST_ID), 'longPress')

    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(router.getPathname()).toBe(collectionPathOf(LIBRARY_SEGMENTS.albums))
    expectFact({ label: COVER_FACT_LABELS.released, value: '1997' })
    expectFact({ label: COVER_FACT_LABELS.tracks, value: '3' })
    expect(
      await screen.findByLabelText(
        KIT_COPY.labelled({ label: COVER_FACT_LABELS.format, value: 'FLAC · 16-bit / 44.1 kHz' }),
      ),
    ).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: TRACK_MENU_COPY.goToArtist }))
    expect(await screen.findByRole('header', { name: RADIOHEAD.name })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id }))
  })

  it('opens the album still on a short tap on its cover', async () => {
    const router = await renderRouter(WREN_TREE, {
      initialUrl: collectionPathOf(LIBRARY_SEGMENTS.albums),
    })

    await fireEvent.press(within(await albumTile()).getByTestId(HELD_COVER_TEST_ID))

    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id }))
  })

  it("offers the album's menu to the screen reader as the tile's long press", async () => {
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.albums) })
    const tile = await albumTile()

    expect(tile.props.accessibilityHint).toBe(COVER_MENU_COPY.holdHint)
    await fireEvent(tile, 'accessibilityAction', SCREEN_READER_HOLD)

    expect(await screen.findByRole('button', { name: TRACK_MENU_COPY.goToAlbum })).toBeTruthy()
  })

  it("opens from a song row's art about the song, while holding the rest of the row opens its menu", async () => {
    await renderRouter(WREN_TREE, { initialUrl: collectionPathOf(LIBRARY_SEGMENTS.favourites) })
    const row = await screen.findByRole('button', { name: AIRBAG.title })

    await fireEvent(within(row).getByTestId(HELD_COVER_TEST_ID), 'longPress')

    expect(
      await screen.findByLabelText(
        KIT_COPY.labelled({ label: COVER_FACT_LABELS.album, value: OK_COMPUTER.title }),
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: TRACK_MENU_COPY.playNext })).toBeNull()
    expect(useAudioQueue.getState().queue.items).toHaveLength(0)
  })

  it("opens from the mini player's cover about the playing song, and goes to its album", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: '/' })
    await act(async () => useAudioQueue.getState().playTracks({ tracks: [AIRBAG] }))
    const bar = await screen.findByRole('button', { name: MINI_PLAYER })

    await fireEvent(within(bar).getByTestId(HELD_COVER_TEST_ID), 'longPress')

    expect(await screen.findByRole('header', { name: AIRBAG.title })).toBeTruthy()
    expectFact({ label: COVER_FACT_LABELS.album, value: OK_COMPUTER.title })
    expectFact({ label: COVER_FACT_LABELS.format, value: 'FLAC · 16-bit / 44.1 kHz · 900 kbps' })
    await fireEvent.press(screen.getByRole('button', { name: TRACK_MENU_COPY.goToAlbum }))
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id }))
  })

  it("opens from Now Playing's cover, held by a finger or the screen reader", async () => {
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.nowPlaying })
    const cover = await screen.findByRole('image', { name: COVER_MENU_COPY.cover(AIRBAG.title) })

    await fireEvent(cover, 'accessibilityAction', SCREEN_READER_HOLD)

    expect(await screen.findByRole('button', { name: TRACK_MENU_COPY.goToArtist })).toBeTruthy()
  })
})
