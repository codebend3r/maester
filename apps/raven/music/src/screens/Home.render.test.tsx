import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_PAGE, MUSIC_SORTS, plural } from '@raven/core'
import type * as Native from '@raven/native'
import { useAudioQueue } from '@raven/ui/headless'
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { LIBRARY_SEGMENTS, WREN_PAGES, WREN_ROUTES, collectionPathOf } from '@/routes'
import { HOME_COPY, LIBRARY_PAGE_COPY } from '@/screens/copy'
import { useWrenAccount } from '@/session'
import {
  AIRBAG,
  LISTENER,
  MUSIC,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  PARANOID,
  musicApi,
} from '@/test/music'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'
import { COUNTS_COPY, KIT_COPY } from '@/ui/copy'

const mockApi = musicApi()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi,
  // jest has no NetInfo native module to ask; the device is on Wi-Fi.
  isOnCellular: async () => false,
  watchNetwork: () => () => undefined,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const GREETINGS = Object.values(HOME_COPY.greeting)

describe('Home', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useAudioQueue.getState().clear()
    useWrenAccount.setState({ session: LISTENER })
  })

  it("greets the listener and shows every music library's newest albums, and opens one", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    const tile = await screen.findByRole('button', { name: `${OK_COMPUTER.title}, Radiohead` })
    expect(screen.getByRole('header', { name: LIBRARY_PAGE_COPY.recent })).toBeTruthy()
    expect(
      screen.getAllByRole('header').some(({ props }) => GREETINGS.includes(props.children)),
    ).toBe(true)
    expect(mockApi.listAlbums).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      sort: MUSIC_SORTS.added,
      limit: 20,
    })

    await fireEvent.press(tile)
    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id }))
  })

  it('opens Albums from See all', async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await fireEvent.press(
      await screen.findByRole('link', { name: KIT_COPY.seeAllOf(LIBRARY_PAGE_COPY.recent) }),
    )
    expect(router.getPathname()).toBe(collectionPathOf(LIBRARY_SEGMENTS.albums))
  })

  it('shuffles a random page of every song', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    const shuffle = await screen.findByRole('button', {
      name: KIT_COPY.labelled({
        label: HOME_COPY.shuffleAll,
        value: plural({ n: OK_COMPUTER.trackCount, ...COUNTS_COPY.songs }),
      }),
    })
    await fireEvent.press(shuffle)
    expect(mockApi.listTracks).toHaveBeenCalledWith({
      libraryId: MUSIC.id,
      sort: MUSIC_SORTS.random,
      limit: MUSIC_PAGE.most,
      offset: 0,
    })
    expect(useAudioQueue.getState().queue.isShuffled).toBe(true)
    expect(useAudioQueue.getState().queue.items).toHaveLength(OK_COMPUTER_PAGE.tracks.length)
  })

  it('keeps Shuffle all pressable with no count while the songs are counted', async () => {
    mockApi.listTracks.mockImplementationOnce(() => new Promise(() => {}))
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    const shuffle = await screen.findByRole('button', { name: HOME_COPY.shuffleAll })
    expect(shuffle.props.accessibilityState).toEqual({ disabled: false })
    expect(mockApi.listTracks).toHaveBeenCalledWith({ libraryId: MUSIC.id, search: '', limit: 1 })
    expect(mockApi.listAlbums).not.toHaveBeenCalledWith(
      expect.objectContaining({ sort: MUSIC_SORTS.title }),
    )
  })

  it('offers to continue the queue where it stands', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await act(async () =>
      useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID], startAt: 1 }),
    )
    const line = HOME_COPY.continueLine({
      artists: 'Radiohead',
      track: HOME_COPY.trackOf({ at: 2, count: 2 }),
    })
    expect(
      await screen.findByRole('button', {
        name: HOME_COPY.continueLabel({ album: OK_COMPUTER.title, line }),
      }),
    ).toBeTruthy()
  })

  it('says so when raven holds no music', async () => {
    mockApi.listLibraries.mockResolvedValue([])
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    expect(await screen.findByText('raven has no music library yet.')).toBeTruthy()
  })
})
