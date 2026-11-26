import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_SORTS, artistNames } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import {
  HOME_COPY,
  KIT_COPY,
  LIBRARY_PAGE_COPY,
  RECENT_SORTS,
  recentDateLineOf,
  DEFAULT_SHARED_PREFS,
} from '@raven/wren'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_PAGES, WREN_ROUTES } from '@raven/wren-native/headless'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { LISTENER, MUSIC, OK_COMPUTER, musicApi } from '@/test/music'
import type * as NativeMock from '@/test/nativeMock'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () =>
  jest
    .requireActual<typeof NativeMock>('@/test/nativeMock')
    .nativeModuleMock({ apiOf: () => mockApi }),
)

const GREETINGS: readonly string[] = Object.values(HOME_COPY.greeting)

const okComputerTile = (sort: (typeof RECENT_SORTS)[keyof typeof RECENT_SORTS]) =>
  KIT_COPY.labelled({
    label: KIT_COPY.labelled({ label: OK_COMPUTER.title, value: artistNames(OK_COMPUTER) }),
    value: recentDateLineOf({ album: OK_COMPUTER, sort }),
  })

describe('Home', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useAudioQueue.getState().clear()
    useWrenAccount.setState({ session: LISTENER })
    useWrenPrefs.setState(DEFAULT_SHARED_PREFS)
  })

  it("greets the listener and shows every music library's newest albums, and opens one", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    const tile = await screen.findByRole('button', { name: okComputerTile(RECENT_SORTS.added) })
    expect(screen.getByRole('header', { name: LIBRARY_PAGE_COPY.recent })).toBeTruthy()
    expect(
      screen.getAllByRole('header').some(({ props }) => GREETINGS.includes(props.children)),
    ).toBe(true)
    expect(mockApi.listAlbums).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: MUSIC.id, sort: MUSIC_SORTS.added }),
    )

    await fireEvent.press(tile)
    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id }))
  })

  it('lists the albums by their latest release once asked, and keeps the choice', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await fireEvent.press(await screen.findByRole('radio', { name: HOME_COPY.sorts.release }))
    expect(await screen.findByRole('header', { name: HOME_COPY.latestReleases })).toBeTruthy()
    expect(useWrenPrefs.getState().homeSort).toBe(RECENT_SORTS.release)
  })

  it('offers Shuffle all and the playlists, and no downloads, which a TV keeps none of', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    expect(
      await screen.findByRole('button', { name: new RegExp(HOME_COPY.shuffleAll) }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: new RegExp(`^${LIBRARY_PAGE_COPY.playlists}`) }),
    ).toBeTruthy()
    expect(screen.queryByText(LIBRARY_PAGE_COPY.downloads)).toBeNull()
  })
})
