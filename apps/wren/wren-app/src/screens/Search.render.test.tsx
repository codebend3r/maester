import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_PAGE, MUSIC_SORTS } from '@raven/core'
import type * as Native from '@raven/native'
import { useAudioQueue } from '@raven/ui/headless'
import { LIBRARY_COPY, LIBRARY_SEGMENTS, RECENT_KINDS, SEARCH_COPY } from '@raven/wren'
import { router as navigation } from 'expo-router'
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount, useRecentSearches } from '@raven/wren-native'
import { WREN_PAGES, WREN_ROUTES, collectionPathOf } from '@raven/wren-native/headless'
import {
  AIRBAG,
  LISTENER,
  MUSIC,
  OK_COMPUTER,
  RADIOHEAD,
  musicApi,
} from '@raven/wren-native/testing'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

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

const searchFor = async (text: string) => {
  const box = await screen.findByLabelText(SEARCH_COPY.label)
  await fireEvent.changeText(box, text)
  await fireEvent(box, 'submitEditing')
  return box
}

describe('Search', () => {
  beforeEach(() => {
    // Each test starts from the library as musicApi answers it, whatever the last one set.
    Object.assign(mockApi, musicApi())
    queryClient.clear()
    useAudioQueue.getState().clear()
    useRecentSearches.setState({ recents: [] })
    useWrenAccount.setState({ session: LISTENER })
  })

  it('shows the albums, artists and songs the search was answered with', async () => {
    mockApi.listTracks.mockResolvedValue({ tracks: [AIRBAG], total: 1 })
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.search })
    await searchFor('radio')

    expect(
      await screen.findByRole('button', { name: `${OK_COMPUTER.title}, Radiohead` }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: RADIOHEAD.name })).toBeTruthy()
    expect(screen.getByRole('button', { name: AIRBAG.title })).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: `${SEARCH_COPY.topResult({ kind: SEARCH_COPY.song })}, ${AIRBAG.title}`,
      }),
    ).toBeTruthy()
    const search = { libraryId: MUSIC.id, search: 'radio', sort: MUSIC_SORTS.title }
    expect(mockApi.listAlbums).toHaveBeenCalledWith(search)
    expect(mockApi.listArtists).toHaveBeenCalledWith({ libraryId: MUSIC.id, search: 'radio' })
    expect(mockApi.listTracks).toHaveBeenCalledWith({
      ...search,
      seed: 0,
      limit: MUSIC_PAGE.most,
      offset: 0,
    })
  })

  it('plays a song found from it, and narrows the results by a chip', async () => {
    mockApi.listTracks.mockResolvedValue({ tracks: [AIRBAG], total: 1 })
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.search })
    await searchFor('radio')
    await fireEvent.press(await screen.findByRole('button', { name: AIRBAG.title }))
    expect(useAudioQueue.getState().tracks[AIRBAG.id]).toEqual(AIRBAG)

    await fireEvent.press(screen.getByRole('radio', { name: SEARCH_COPY.artists }))
    expect(await screen.findByRole('button', { name: RADIOHEAD.name })).toBeTruthy()
    expect(screen.queryByRole('button', { name: AIRBAG.title })).toBeNull()
  })

  it('asks nothing until something is typed, and offers to clear a search that matched nothing', async () => {
    mockApi.listAlbums.mockResolvedValue([])
    mockApi.listArtists.mockResolvedValue([])
    mockApi.listTracks.mockResolvedValue({ tracks: [], total: 0 })
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.search })
    expect(await screen.findByText(SEARCH_COPY.browse)).toBeTruthy()
    expect(mockApi.listAlbums).not.toHaveBeenCalled()

    await searchFor('zz')
    expect(await screen.findByText(SEARCH_COPY.noMatches('zz'))).toBeTruthy()
    expect(screen.getByText(SEARCH_COPY.noMatchesHint)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: SEARCH_COPY.clearSearch }))
    expect(await screen.findByText(SEARCH_COPY.browse)).toBeTruthy()
  })

  it('says raven holds no music, rather than searching for ever, when it has no music library', async () => {
    mockApi.listLibraries.mockResolvedValue([])
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.search })
    await searchFor('radio')
    expect(await screen.findByText(LIBRARY_COPY.noMusic)).toBeTruthy()
    expect(screen.queryByLabelText(SEARCH_COPY.searching)).toBeNull()
    expect(mockApi.listTracks).not.toHaveBeenCalled()
  })

  it("opens Library's list from a Browse tile", async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.search })
    await fireEvent.press(await screen.findByRole('link', { name: SEARCH_COPY.downloaded }))
    expect(router.getPathname()).toBe(collectionPathOf(LIBRARY_SEGMENTS.downloads))
  })

  it('remembers a search submitted and an artist opened, and forgets them', async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.search })
    await searchFor('radio')
    await fireEvent.press(await screen.findByRole('button', { name: RADIOHEAD.name }))
    expect(router.getPathname()).toBe(pagePathOf({ page: WREN_PAGES.artist, id: RADIOHEAD.id }))
    expect(useRecentSearches.getState().recents).toEqual([
      { kind: RECENT_KINDS.artist, id: RADIOHEAD.id, name: RADIOHEAD.name },
      { kind: RECENT_KINDS.query, text: 'radio' },
    ])

    await act(async () => navigation.back())
    await searchFor('')
    expect(await screen.findByText(SEARCH_COPY.recent)).toBeTruthy()
    await fireEvent.press(
      screen.getByRole('button', { name: SEARCH_COPY.removeRecent(RADIOHEAD.name) }),
    )
    expect(
      screen.queryByRole('button', { name: SEARCH_COPY.removeRecent(RADIOHEAD.name) }),
    ).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: SEARCH_COPY.clearRecentLabel }))
    expect(screen.queryByText(SEARCH_COPY.recent)).toBeNull()
  })
})
