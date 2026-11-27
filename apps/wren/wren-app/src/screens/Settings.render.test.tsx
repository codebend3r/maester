import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AUDIO_BITRATES } from '@raven/core'
import type * as Native from '@raven/native'
import { RAVEN_SERVER, RENAME_OUTCOMES } from '@raven/native/headless'
import {
  COLOR_SCHEMES,
  type ColorScheme,
  KIT_COPY,
  SETTINGS_COPY,
  SIGN_IN_COPY,
  STATUS_COPY,
  STORAGE_COPY,
  THEME_MODES,
  WREN_THEMES,
} from '@raven/wren'
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library'
import { Dimensions } from 'react-native'

import { wrenVersion } from '@/about/version'
import {
  DOWNLOAD_STATUSES,
  type DownloadEntry,
  downloadKeyOf,
  useDownloads,
} from '@/downloads/downloadStore'
import { queryClient } from '@/queryClient'
import { useWrenAccount, accountServers, useActiveServer } from '@raven/wren-native'
import { WREN_ROUTES } from '@raven/wren-native/headless'
import { DEFAULT_WREN_PREFS, useWrenPrefs } from '@/stores/wrenPrefs'
import { PHONE_WINDOW } from '@/test/jestSetup'
import {
  AIRBAG,
  LISTENER,
  MUSIC,
  OK_COMPUTER,
  PARANOID,
  musicApi,
} from '@raven/wren-native/testing'
import { WREN_TREE } from '@/test/wrenTree'

const mockApi = musicApi()
const removeAll = jest.fn<ReturnType<typeof useDownloads.getState>['removeAll']>()

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

// An 11 inch iPad's window, held sideways.
const TABLET_WINDOW = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const

const holdAs = (window: typeof PHONE_WINDOW | typeof TABLET_WINDOW) =>
  act(() => Dimensions.set({ window, screen: window }))

const entryFor = (track: typeof AIRBAG): DownloadEntry => ({
  mediaId: track.id,
  serverId: RAVEN_SERVER.id,
  kbps: AUDIO_BITRATES.standard,
  bytes: 4_200_000,
  path: `downloads/${RAVEN_SERVER.id}/${track.id}/media.m4a`,
  coverPath: null,
  track,
  album: OK_COMPUTER,
  status: DOWNLOAD_STATUSES.done,
  queueStamp: 1,
})

/** OK Computer's first two tracks, 8.4 MB on the device. */
const DOWNLOADED = Object.fromEntries(
  [AIRBAG, PARANOID].map((track) => [
    downloadKeyOf({ serverId: RAVEN_SERVER.id, id: track.id }),
    entryFor(track),
  ]),
)

const openSettings = async () => {
  const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.settings })
  await screen.findByRole('header', { name: SETTINGS_COPY.title })
  return router
}

describe('Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    removeAll.mockResolvedValue(undefined)
    mockApi.listLibraries.mockResolvedValue([MUSIC])
    useDownloads.setState({ entries: {}, playlists: {}, removeAll })
  })

  afterEach(() => holdAs(PHONE_WINDOW))

  it('says who is signed in, to which server, whether it answers, and which Wren this is', async () => {
    await openSettings()
    expect(screen.getByText(LISTENER.email)).toBeTruthy()
    expect(screen.getByText(RAVEN_SERVER.name)).toBeTruthy()
    expect(
      screen.getByLabelText(
        KIT_COPY.labelled({ label: SETTINGS_COPY.serverAddress, value: RAVEN_SERVER.origin }),
      ),
    ).toBeTruthy()
    expect(screen.getByText(SETTINGS_COPY.serverNote)).toBeTruthy()
    expect(await screen.findByLabelText(STATUS_COPY.connected(RAVEN_SERVER.name))).toBeTruthy()
    expect(
      screen.getByLabelText(
        KIT_COPY.labelled({
          label: SETTINGS_COPY.version,
          value: SETTINGS_COPY.versionOf(wrenVersion),
        }),
      ),
    ).toBeTruthy()
  })

  it("says when the server can't be reached", async () => {
    mockApi.listLibraries.mockRejectedValue(new Error("raven can't be reached."))
    await openSettings()
    expect(await screen.findByLabelText(STATUS_COPY.unreachable(RAVEN_SERVER.name))).toBeTruthy()
  })

  it("names the server on the account, and wears the account's name wherever it says what it is connected to", async () => {
    const rename = jest.spyOn(accountServers, 'rename').mockImplementation(async ({ name }) => {
      await useActiveServer.getState().follow({ servers: [], homeServerId: null, homeName: name })
      return RENAME_OUTCOMES.renamed
    })
    await openSettings()
    const field = screen.getByLabelText(SETTINGS_COPY.serverName)
    await fireEvent.changeText(field, '  Living   room ')
    await fireEvent(field, 'submitEditing')
    expect(rename).toHaveBeenCalledWith({ id: RAVEN_SERVER.id, name: 'Living room' })
    expect(await screen.findByLabelText(STATUS_COPY.connected('Living room'))).toBeTruthy()
    rename.mockRestore()
    await useActiveServer.getState().follow({ servers: [], homeServerId: null, homeName: null })
  })

  it('keeps the name when the field is left blank, and refuses one that is too long', async () => {
    const rename = jest.spyOn(accountServers, 'rename')
    await openSettings()
    const field = screen.getByLabelText(SETTINGS_COPY.serverName)
    await fireEvent.changeText(field, '')
    await fireEvent(field, 'blur')
    expect(screen.getByDisplayValue(RAVEN_SERVER.name)).toBeTruthy()
    await fireEvent.changeText(field, 'x'.repeat(81))
    await fireEvent(field, 'submitEditing')
    expect(screen.getByText(SETTINGS_COPY.serverNameError)).toBeTruthy()
    expect(rename).not.toHaveBeenCalled()
    rename.mockRestore()
  })

  it('says so when there is no account to keep the name', async () => {
    const rename = jest.spyOn(accountServers, 'rename').mockResolvedValue(RENAME_OUTCOMES.noAccount)
    await openSettings()
    const field = screen.getByLabelText(SETTINGS_COPY.serverName)
    await fireEvent.changeText(field, 'Den')
    await fireEvent(field, 'submitEditing')
    expect(await screen.findByText(SETTINGS_COPY.serverNameNoAccount)).toBeTruthy()
    rename.mockRestore()
  })

  it('switches the music library worn', async () => {
    const vinyl = { ...MUSIC, id: 6, name: 'Vinyl' }
    mockApi.listLibraries.mockResolvedValue([MUSIC, vinyl])
    await openSettings()

    const worn = await screen.findByRole('radio', { name: MUSIC.name })
    expect(worn.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }))

    await fireEvent.press(screen.getByRole('radio', { name: vinyl.name }))
    expect(useWrenPrefs.getState().libraryId).toBe(vinyl.id)
    expect(screen.getByRole('radio', { name: vinyl.name }).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    )
  })

  it('keeps one theme whatever the device says, with no slots to pick', async () => {
    await openSettings()
    await fireEvent.press(
      screen.getByRole('radio', { name: SETTINGS_COPY.themeModes[THEME_MODES.single] }),
    )
    expect(screen.queryByLabelText(SETTINGS_COPY.themeSlots)).toBeNull()

    const garnet = SETTINGS_COPY.themeNames[WREN_THEMES.garnet]
    await fireEvent.press(screen.getByRole('radio', { name: garnet }))
    expect(useWrenPrefs.getState()).toMatchObject({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.garnet,
    })
    expect(screen.getByRole('radio', { name: garnet }).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    )
  })

  it("keeps a theme for each of the device's schemes", async () => {
    await openSettings()
    expect(screen.getByLabelText(SETTINGS_COPY.themeSlots)).toBeTruthy()
    expect(screen.getByText(SETTINGS_COPY.showingNow)).toBeTruthy()

    const slot = (scheme: ColorScheme) =>
      screen.getByRole('radio', { name: new RegExp(`^${SETTINGS_COPY.themeSlotNames[scheme]},`) })
    await fireEvent.press(slot(COLOR_SCHEMES.light))
    await fireEvent.press(
      screen.getByRole('radio', { name: SETTINGS_COPY.themeNames[WREN_THEMES.banana] }),
    )
    await fireEvent.press(slot(COLOR_SCHEMES.dark))
    await fireEvent.press(
      screen.getByRole('radio', { name: SETTINGS_COPY.themeNames[WREN_THEMES.ember] }),
    )
    expect(useWrenPrefs.getState()).toMatchObject({
      themeMode: THEME_MODES.system,
      lightTheme: WREN_THEMES.banana,
      darkTheme: WREN_THEMES.ember,
    })
  })

  it('sets the download quality, the cellular quality and the storage limit', async () => {
    await openSettings()
    const [downloadHigh] = screen.getAllByRole('radio', { name: String(AUDIO_BITRATES.high) })
    await fireEvent.press(downloadHigh)
    expect(useWrenPrefs.getState().downloadKbps).toBe(AUDIO_BITRATES.high)
    await fireEvent.press(screen.getByRole('radio', { name: SETTINGS_COPY.original }))
    expect(useWrenPrefs.getState().cellularKbps).toBeNull()

    await fireEvent.press(
      screen.getByRole('button', {
        name: KIT_COPY.labelled({
          label: SETTINGS_COPY.storageLimit,
          value: STORAGE_COPY.off,
        }),
      }),
    )
    await fireEvent.press(await screen.findByRole('radio', { name: STORAGE_COPY.gigabytes(5) }))
    expect(useWrenPrefs.getState().storageLimitGb).toBe(5)
  })

  it('measures the downloads against the storage limit', async () => {
    useDownloads.setState({ entries: DOWNLOADED })
    await openSettings()
    await act(async () => useWrenPrefs.setState({ storageLimitGb: 2 }))
    expect(
      screen.getByLabelText(
        KIT_COPY.labelled({
          label: SETTINGS_COPY.usedByDownloads,
          value: STORAGE_COPY.usedOf({ used: '8.4 MB', limit: STORAGE_COPY.gigabytes(2) }),
        }),
      ),
    ).toBeTruthy()
  })

  it('asks before removing every download, saying how much goes and where it still streams from', async () => {
    useDownloads.setState({ entries: DOWNLOADED })
    await openSettings()
    const removeAllButton = screen.getByRole('button', { name: SETTINGS_COPY.removeAll })

    await fireEvent.press(removeAllButton)
    const body = SETTINGS_COPY.removeAllBody({ size: '8.4 MB', server: RAVEN_SERVER.name })
    expect(await screen.findByText(body)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: KIT_COPY.cancel }))
    expect(removeAll).not.toHaveBeenCalled()

    await fireEvent.press(removeAllButton)
    await fireEvent.press(await screen.findByRole('button', { name: SETTINGS_COPY.remove }))
    expect(removeAll).toHaveBeenCalled()
  })

  it('offers no removal with nothing downloaded', async () => {
    await openSettings()
    expect(
      screen.getByRole('button', { name: SETTINGS_COPY.removeAll }).props.accessibilityState,
    ).toEqual(expect.objectContaining({ disabled: true }))
  })

  it("shows the fonts' licences", async () => {
    await openSettings()
    await fireEvent.press(screen.getByRole('button', { name: SETTINGS_COPY.licenses }))
    expect(await screen.findByText(SETTINGS_COPY.fontLicense)).toBeTruthy()
  })

  it('sets the downloads beside the rest on a tablet', async () => {
    await holdAs(TABLET_WINDOW)
    await openSettings()
    expect(screen.getByRole('header', { name: SETTINGS_COPY.downloads })).toBeTruthy()
    expect(screen.getByRole('header', { name: SETTINGS_COPY.about })).toBeTruthy()
  })

  it('shows the music libraries once on a tablet', async () => {
    await holdAs(TABLET_WINDOW)
    await openSettings()
    expect(await screen.findAllByRole('header', { name: SETTINGS_COPY.library })).toHaveLength(1)
  })

  it('signs out, forgetting the account, and lands on sign-in', async () => {
    const router = await openSettings()
    await fireEvent.press(screen.getByRole('button', { name: SETTINGS_COPY.signOut }))

    expect(useWrenAccount.getState().session).toBeNull()
    expect(await screen.findByLabelText(SIGN_IN_COPY.email)).toBeTruthy()
    expect(router.getPathname()).toBe(WREN_ROUTES.signIn)
  })

  it('sends a listener who is not signed in to sign-in', async () => {
    useWrenAccount.setState({ session: null })
    const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.settings })
    expect(await screen.findByLabelText(SIGN_IN_COPY.email)).toBeTruthy()
    expect(router.getPathname()).toBe(WREN_ROUTES.signIn)
  })
})
