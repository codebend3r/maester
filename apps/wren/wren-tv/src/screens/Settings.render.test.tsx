import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { RAVEN_SERVER, RENAME_OUTCOMES } from '@raven/native/headless'
import {
  COLOR_SCHEMES,
  type ColorScheme,
  KIT_COPY,
  SETTINGS_COPY,
  SIGN_IN_COPY,
  STATUS_COPY,
  THEME_MODES,
  WREN_THEMES,
  DEFAULT_SHARED_PREFS,
} from '@raven/wren'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'
import { useWrenAccount, accountServers, useActiveServer } from '@raven/wren-native'
import { WREN_ROUTES } from '@raven/wren-native/headless'

import { wrenVersion } from '@/about/version'
import { queryClient } from '@/queryClient'
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
  jest
    .requireActual<typeof NativeMock>('@/test/nativeMock')
    .nativeModuleMock({ apiOf: () => mockApi }),
)

/** A scheme's slot and the theme picked for it. */
type ThemePick = { scheme: ColorScheme; theme: string }

const openSettings = async () => {
  const router = await renderRouter(WREN_TREE, { initialUrl: WREN_ROUTES.settings })
  await screen.findByRole('header', { name: SETTINGS_COPY.title })
  return router
}

const isPicked = (name: string) =>
  screen.getByRole('radio', { name }).props.accessibilityState?.checked ?? false

const serverStatus = (status: string) =>
  KIT_COPY.labelled({ label: SETTINGS_COPY.server, value: status })

describe('Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queryClient.clear()
    useWrenAccount.setState({ session: LISTENER })
    useWrenPrefs.setState(DEFAULT_SHARED_PREFS)
    mockApi.listLibraries.mockResolvedValue([MUSIC])
  })

  it('says who is signed in, to which server, whether it answers, and which Wren this is', async () => {
    await openSettings()
    expect(screen.getByText(LISTENER.email)).toBeTruthy()
    expect(
      screen.getByLabelText(
        KIT_COPY.labelled({ label: SETTINGS_COPY.serverAddress, value: RAVEN_SERVER.origin }),
      ),
    ).toBeTruthy()
    expect(screen.getByText(SETTINGS_COPY.serverNote)).toBeTruthy()
    expect(
      await screen.findByLabelText(serverStatus(STATUS_COPY.connected(RAVEN_SERVER.name))),
    ).toBeTruthy()
    expect(
      screen.getByLabelText(
        KIT_COPY.labelled({
          label: SETTINGS_COPY.version,
          value: SETTINGS_COPY.versionOf(wrenVersion),
        }),
      ),
    ).toBeTruthy()
  })

  it('has no downloads group, which a TV keeps none of', async () => {
    await openSettings()
    expect(screen.queryByRole('header', { name: SETTINGS_COPY.downloads })).toBeNull()
    expect(screen.queryByText(SETTINGS_COPY.cellularQuality)).toBeNull()
  })

  it("says when the server can't be reached", async () => {
    mockApi.listLibraries.mockRejectedValue(new Error("raven can't be reached."))
    await openSettings()
    expect(
      await screen.findByLabelText(serverStatus(STATUS_COPY.unreachable(RAVEN_SERVER.name))),
    ).toBeTruthy()
  })

  it('names the server on the account', async () => {
    const rename = jest.spyOn(accountServers, 'rename').mockImplementation(async ({ name }) => {
      await useActiveServer.getState().follow({ servers: [], homeServerId: null, homeName: name })
      return RENAME_OUTCOMES.renamed
    })
    await openSettings()
    const field = screen.getByLabelText(SETTINGS_COPY.serverName)
    await fireEvent.changeText(field, '  Living   room ')
    await fireEvent(field, 'submitEditing')
    expect(rename).toHaveBeenCalledWith({ id: RAVEN_SERVER.id, name: 'Living room' })
    expect(
      await screen.findByLabelText(serverStatus(STATUS_COPY.connected('Living room'))),
    ).toBeTruthy()
    rename.mockRestore()
    await useActiveServer.getState().follow({ servers: [], homeServerId: null, homeName: null })
  })

  it('switches the music library worn', async () => {
    const vinyl = { ...MUSIC, id: 6, name: 'Vinyl' }
    mockApi.listLibraries.mockResolvedValue([MUSIC, vinyl])
    await openSettings()
    await screen.findByRole('radio', { name: vinyl.name })
    expect(isPicked(MUSIC.name)).toBe(true)

    await fireEvent.press(screen.getByRole('radio', { name: vinyl.name }))
    expect(useWrenPrefs.getState().libraryId).toBe(vinyl.id)
    expect(isPicked(vinyl.name)).toBe(true)
  })

  it('keeps one theme whatever the TV says, picked from the sheet of themes', async () => {
    await openSettings()
    await fireEvent.press(
      screen.getByRole('radio', { name: SETTINGS_COPY.themeModes[THEME_MODES.single] }),
    )
    expect(screen.queryByLabelText(SETTINGS_COPY.themeSlots)).toBeNull()

    await fireEvent.press(
      screen.getByRole('button', { name: new RegExp(`^${SETTINGS_COPY.theme},`) }),
    )
    await fireEvent.press(
      await screen.findByRole('radio', { name: SETTINGS_COPY.themeNames[WREN_THEMES.garnet] }),
    )
    expect(useWrenPrefs.getState()).toMatchObject({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.garnet,
    })
  })

  it("keeps a theme for each of the TV's schemes", async () => {
    await openSettings()
    expect(screen.getByLabelText(SETTINGS_COPY.themeSlots)).toBeTruthy()
    const slot = (scheme: ColorScheme) =>
      screen.getByRole('radio', { name: new RegExp(`^${SETTINGS_COPY.themeSlotNames[scheme]},`) })
    const pick = async ({ scheme, theme }: ThemePick) => {
      await fireEvent.press(slot(scheme))
      await fireEvent.press(
        screen.getByRole('button', {
          name: new RegExp(`^${SETTINGS_COPY.themeFor[scheme]},`),
        }),
      )
      await fireEvent.press(await screen.findByRole('radio', { name: theme }))
    }
    await pick({ scheme: COLOR_SCHEMES.light, theme: SETTINGS_COPY.themeNames[WREN_THEMES.banana] })
    await pick({ scheme: COLOR_SCHEMES.dark, theme: SETTINGS_COPY.themeNames[WREN_THEMES.ember] })
    expect(useWrenPrefs.getState()).toMatchObject({
      themeMode: THEME_MODES.system,
      lightTheme: WREN_THEMES.banana,
      darkTheme: WREN_THEMES.ember,
    })
  })

  it("shows the fonts' licences", async () => {
    await openSettings()
    await fireEvent.press(screen.getByRole('button', { name: SETTINGS_COPY.licenses }))
    expect(await screen.findByText(SETTINGS_COPY.fontLicense)).toBeTruthy()
  })

  it('signs out, forgetting the account, and lands on sign-in', async () => {
    const router = await openSettings()
    await fireEvent.press(screen.getByRole('button', { name: SETTINGS_COPY.signOut }))
    expect(useWrenAccount.getState().session).toBeNull()
    expect(await screen.findByLabelText(SIGN_IN_COPY.email)).toBeTruthy()
    expect(router.getPathname()).toBe(WREN_ROUTES.signIn)
  })
})
