import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { QUEUE_SOURCE_KINDS } from '@raven/core'
import type * as Native from '@raven/native'
import { useAudioQueue } from '@raven/ui/headless'
import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library'

import { queryClient } from '@/queryClient'
import { useWrenAccount } from '@/session'
import { AIRBAG, LISTENER, MIXTAPE, OK_COMPUTER, OK_COMPUTER_PAGE, musicApi } from '@/test/music'
import { WREN_PAGES } from '@/routes'
import { pagePathOf } from '@/test/routes'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()
const playTracks = jest.fn<ReturnType<typeof useAudioQueue.getState>['playTracks']>()
const playNext = jest.fn<ReturnType<typeof useAudioQueue.getState>['playNext']>()
const addToQueue = jest.fn<ReturnType<typeof useAudioQueue.getState>['addToQueue']>()

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const ALBUM_URL = pagePathOf({ page: WREN_PAGES.album, id: OK_COMPUTER.id })

describe('Album', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.setState({ playTracks, playNext, addToQueue })
  })

  it('lists the tracks under each disc in order, and plays the album from the top', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })

    expect(await screen.findByRole('header', { name: OK_COMPUTER.title })).toBeTruthy()
    const discs = screen.getAllByRole('header').map((header) => header.props.children)
    expect(discs.filter((title) => title === 'Disc 1' || title === 'Disc 2')).toEqual([
      'Disc 1',
      'Disc 2',
    ])
    expect(
      screen.getAllByRole('button', { name: /^\d\. / }).map((row) => row.props.accessibilityLabel),
    ).toEqual(['1. Airbag', '2. Paranoid Android', '3. Lucky'])

    await fireEvent.press(screen.getByRole('button', { name: 'Play' }))
    expect(playTracks).toHaveBeenCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id },
    })
  })

  it('plays from the track pressed, and shuffles the album', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('button', { name: '2. Paranoid Android' }))
    expect(playTracks).toHaveBeenCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      startAt: 1,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id },
    })

    await fireEvent.press(screen.getByRole('button', { name: 'Shuffle' }))
    expect(playTracks).toHaveBeenLastCalledWith({
      tracks: OK_COMPUTER_PAGE.tracks,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: OK_COMPUTER.id },
      isShuffled: true,
    })
  })

  it("puts a held row's track next, at the end of the queue, or on a playlist", async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    const airbag = await screen.findByRole('button', { name: '1. Airbag' })

    await fireEvent(airbag, 'longPress')
    await fireEvent.press(await screen.findByRole('button', { name: 'Play next' }))
    expect(playNext).toHaveBeenCalledWith([AIRBAG])

    await fireEvent(airbag, 'longPress')
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to queue' }))
    expect(addToQueue).toHaveBeenCalledWith([AIRBAG])

    await fireEvent.press(screen.getByRole('button', { name: 'More for Airbag' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to playlist' }))
    const sheet = await screen.findByLabelText('Add Airbag to a playlist')
    await fireEvent.press(await within(sheet).findByRole('button', { name: MIXTAPE.name }))
    expect(await screen.findByText(`Added to ${MIXTAPE.name}.`)).toBeTruthy()
    expect(mockApi.appendPlaylistTracks).toHaveBeenCalledWith({
      id: MIXTAPE.id,
      mediaIds: [AIRBAG.id],
    })
  })

  it('shows why adding a track to a playlist was refused', async () => {
    mockApi.appendPlaylistTracks.mockRejectedValueOnce(new Error('Playlist is full.'))
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await screen.findByRole('button', { name: '1. Airbag' })
    await fireEvent.press(screen.getByRole('button', { name: 'More for Airbag' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to playlist' }))
    const sheet = await screen.findByLabelText('Add Airbag to a playlist')
    await fireEvent.press(await within(sheet).findByRole('button', { name: MIXTAPE.name }))

    expect(await screen.findByText('Playlist is full.')).toBeTruthy()
    expect(screen.queryByText(`Added to ${MIXTAPE.name}.`)).toBeNull()
  })

  it("offers only the listener's own playlists, not another account's shared one", async () => {
    const theirs = {
      ...MIXTAPE,
      id: MIXTAPE.id + 1,
      name: 'Their mix',
      isShared: true,
      isOwn: false,
    }
    mockApi.listPlaylists.mockResolvedValueOnce([MIXTAPE, theirs])
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })

    await fireEvent.press(await screen.findByRole('button', { name: 'More for Airbag' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to playlist' }))
    const sheet = await screen.findByLabelText('Add Airbag to a playlist')
    expect(await within(sheet).findByRole('button', { name: MIXTAPE.name })).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: theirs.name })).toBeNull()
  })

  it('marks the album a favourite', async () => {
    await renderRouter(WREN_TREE, { initialUrl: ALBUM_URL })
    await fireEvent.press(await screen.findByRole('switch', { name: 'Favourite' }))
    expect(mockApi.setAlbumFavourite).toHaveBeenCalledWith({
      albumId: OK_COMPUTER.id,
      favourite: true,
    })
  })

  it('says so when the album is not on the server', async () => {
    await renderRouter(WREN_TREE, {
      initialUrl: pagePathOf({ page: WREN_PAGES.album, id: 'not-a-number' }),
    })
    expect(await screen.findByText('This album is not on the server.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  })
})
