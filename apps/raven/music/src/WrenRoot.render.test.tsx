import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { audioPlayer } from '@raven/audio'
import { AUDIO_BITRATES } from '@raven/core'
import type * as Native from '@raven/native'
import { queryKeys, useAudioQueue } from '@raven/ui/headless'
import { router } from 'expo-router'
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library'

import {
  DOWNLOAD_STATUSES,
  type DownloadDisk,
  downloadKeyOf,
  useDownloads,
} from '@/downloads/downloadStore'
import { queryClient } from '@/queryClient'
import { WREN_ROUTES } from '@/routes'
import { useWrenAccount } from '@/session'
import { AIRBAG, LISTENER, MIXTAPE, PARANOID, musicApi } from '@/test/music'
import { WREN_TREE } from '@/test/wrenTree'

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

describe('WrenRoot', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useAudioQueue.getState().clear()
  })

  it("forgets what one account read once another signs in, so it never shows the last one's playlists", async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.settings })
    await screen.findByText(`Signed in as ${LISTENER.email}`)
    queryClient.setQueryData(queryKeys.playlistList, [MIXTAPE])

    await act(async () =>
      useWrenAccount.setState({ session: { ...LISTENER, accessToken: 'renewed' } }),
    )
    expect(queryClient.getQueryData(queryKeys.playlistList)).toEqual([MIXTAPE])

    await act(async () => useWrenAccount.setState({ session: { ...LISTENER, userId: 'u2' } }))
    expect(queryClient.getQueryData(queryKeys.playlistList)).toBeUndefined()

    queryClient.setQueryData(queryKeys.playlistList, [MIXTAPE])
    await act(async () => useWrenAccount.setState({ session: null }))
    expect(queryClient.getQueryData(queryKeys.playlistList)).toBeUndefined()
    expect(mockApi.listPlaylists).not.toHaveBeenCalled()
  })

  it("keeps the music through a renewed token and stops the last account's when it signs out, so nothing plays or counts for the next", async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await screen.findByRole('header', { name: 'Home' })
    await act(async () => useAudioQueue.getState().playTracks({ tracks: [AIRBAG, PARANOID] }))
    await waitFor(() => expect(audioPlayer.setWindow).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /^Now Playing: Airbag/ })).toBeTruthy()

    // A renewed token is the same account: the music plays on.
    await act(async () =>
      useWrenAccount.setState({ session: { ...LISTENER, accessToken: 'renewed' } }),
    )
    expect(audioPlayer.stop).not.toHaveBeenCalled()
    expect(useAudioQueue.getState().queue.at).not.toBeNull()
    expect(screen.getByRole('button', { name: /^Now Playing: Airbag/ })).toBeTruthy()

    await act(async () => useWrenAccount.setState({ session: null }))
    expect(audioPlayer.stop).toHaveBeenCalled()

    await act(async () => useWrenAccount.setState({ session: LISTENER }))
    await act(async () => router.replace(WREN_ROUTES.home))
    expect(await screen.findByRole('header', { name: 'Home' })).toBeTruthy()
    expect(useAudioQueue.getState().queue.at).toBeNull()
    expect(screen.queryByRole('button', { name: /^Now Playing: Airbag/ })).toBeNull()
  })

  /** Airbag downloaded under the listener's account, on a disk a test can look at. */
  const downloaded = () => {
    const folder = 'downloads/raven/101'
    const files = new Set([`${folder}/media.m4a`, `${folder}/cover.jpg`])
    const disk: DownloadDisk = {
      fetch: async () => 0,
      uriOf: (path) => path,
      exists: (path) => files.has(path),
      folders: () => [folder],
      remove: async () => undefined,
      removeAll: async () => files.clear(),
    }
    const entry = {
      mediaId: AIRBAG.id,
      serverId: 'raven',
      kbps: AUDIO_BITRATES.standard,
      bytes: 4_000_000,
      path: `${folder}/media.m4a`,
      coverPath: `${folder}/cover.jpg`,
      track: AIRBAG,
      album: null,
      status: DOWNLOAD_STATUSES.done,
      queueStamp: 1,
    }
    useDownloads.setState({
      device: { ...useDownloads.getState().device, disk },
      ownerId: LISTENER.userId,
      entries: { [downloadKeyOf({ serverId: 'raven', id: AIRBAG.id })]: entry },
    })
    return { files }
  }

  it('keeps the downloads as Wren opens, and through a refused refresh until the same account signs in again', async () => {
    const { files } = downloaded()
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await screen.findByRole('header', { name: 'Home' })
    expect(Object.keys(useDownloads.getState().entries)).toHaveLength(1)

    // A refresh the server refused signs the account out.
    await act(async () => useWrenAccount.setState({ session: null }))
    await act(async () => useWrenAccount.setState({ session: LISTENER }))
    expect(Object.keys(useDownloads.getState().entries)).toHaveLength(1)
    expect(files.size).toBe(2)
    expect(audioPlayer.clearBrowseCache).not.toHaveBeenCalled()
  })

  it("removes the last account's downloads, files and all, once another account signs in", async () => {
    await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.home })
    await screen.findByRole('header', { name: 'Home' })
    const { files } = downloaded()

    await act(async () => useWrenAccount.setState({ session: null }))
    await act(async () => useWrenAccount.setState({ session: { ...LISTENER, userId: 'u2' } }))
    expect(useDownloads.getState().entries).toEqual({})
    expect(files.size).toBe(0)
    // The car's kept lists held the last account's titles too.
    await waitFor(() => expect(audioPlayer.clearBrowseCache).toHaveBeenCalledTimes(1))
  })
})
