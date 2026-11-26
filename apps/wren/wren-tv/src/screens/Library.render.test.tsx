import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MUSIC_SORTS } from '@raven/core'
import { KIT_COPY, LIBRARY_PAGE_COPY, LIBRARY_SEGMENTS, DEFAULT_SHARED_PREFS } from '@raven/wren'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@raven/wren-native'
import { WREN_ROUTES, collectionPathOf } from '@raven/wren-native/headless'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { LISTENER, MUSIC, musicApi } from '@raven/wren-native/testing'
import type * as NativeMock from '@/test/nativeMock'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () =>
  jest.requireActual<typeof NativeMock>('@/test/nativeMock').nativeModuleMock({
    apiOf: () => mockApi,
  }),
)

describe('Library', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useWrenPrefs.setState(DEFAULT_SHARED_PREFS)
  })

  it('lists its categories with what each holds, and the newest albums', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    expect(
      await screen.findByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.songs, value: '3' }),
      }),
    ).toBeTruthy()
    expect(
      await screen.findByRole('button', {
        name: KIT_COPY.labelled({ label: LIBRARY_PAGE_COPY.albums, value: '1' }),
      }),
    ).toBeTruthy()
    expect(screen.getByRole('header', { name: LIBRARY_PAGE_COPY.recent })).toBeTruthy()
    expect(mockApi.listAlbums).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: MUSIC.id, sort: MUSIC_SORTS.added }),
    )
  })

  it('leaves Downloads out, since a TV keeps none', async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await screen.findByRole('button', { name: new RegExp(`^${LIBRARY_PAGE_COPY.albums}`) })
    expect(screen.queryByText(LIBRARY_PAGE_COPY.downloads)).toBeNull()
  })

  it('opens a category on a page of its own', async () => {
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.library })
    await fireEvent.press(
      await screen.findByRole('button', { name: new RegExp(`^${LIBRARY_PAGE_COPY.artists}`) }),
    )
    expect(await screen.findByRole('header', { name: LIBRARY_PAGE_COPY.artists })).toBeTruthy()
    expect(router.getPathname()).toBe(collectionPathOf(LIBRARY_SEGMENTS.artists))
  })
})
