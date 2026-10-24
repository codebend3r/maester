import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CLIENT_CALLS, MAX_HEIGHTS, SERVERS_CAP, THEMES, themeOf } from '@raven/core'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { ActionSheetIOS, Alert, type AlertButton, StyleSheet } from 'react-native'

import { LOGO_MARKS } from '@/layouts/Logo'
import { clearOnServerSwitch, clearOnSignOut } from '@/queries/serverCache'
import { APP_ROUTES } from '@/routes'
import { Home } from '@/screens/Home'
import { Settings } from '@/screens/Settings'
import type { AppServer } from '@/servers/serverList'
import { noteSession, useAccountState } from '@/stores/accountState'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { PIN } from '@/test/accountPins'
import { NAS, OTHER, homeApi } from '@/test/homeServer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { createScreenClient, renderScreen } from '@/test/renderScreen'
import { appThemeOf } from '@/theme/appTheme'

const mockPush = jest.fn()
const mockBack = jest.fn()
const mockForget = jest.fn(async (_serverId: string) => undefined)
/** Ends the sign-in as the sessions do: the app hears the server is signed out. */
const mockSignOut = jest.fn(async ({ server }: { server: AppServer }) => {
  noteSession({ serverId: server.id, isSignedIn: false })
})
/** The paths each server was asked for, by its origin. */
const mockServer: { asked: readonly string[] } = { asked: [] }
const mockApi = jest.fn((server: AppServer) => {
  const api = homeApi(server)
  return {
    ...api,
    getHome: async () => {
      mockServer.asked = [...mockServer.asked, `${server.origin}${APP_CLIENT_CALLS.getHome.path}`]
      return api.getHome()
    },
  }
})

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }))
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: (serverId: string) => mockForget(serverId) },
  credentialsFor: async () => ({ cookies: {}, token: null }),
  accountSessions: {
    forget: async () => {},
    signOut: (input: { server: AppServer }) => mockSignOut(input),
  },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

/** The confirmation Remove asks, answered by pressing the button named `answer`. */
const answerAlert = (answer: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    const press = buttons?.find((button) => button.text === answer)?.onPress ?? (() => undefined)
    press()
  })

/** The system sheet a touch picker opens, answered with the option named `answer`. */
const answerSheet = (answer: string) => {
  const asked: { title: string; options: string[] }[] = []
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
    asked.push({ title: options.title ?? '', options: options.options })
    done(options.options.indexOf(answer))
  })
  return asked
}

/** `count` servers on the list, each a well-formed one of its own. */
const serversOf = (count: number): AppServer[] =>
  Array.from({ length: count }, (_, n) => ({
    id: `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, '0')}`,
    name: `nas${n}`,
    origin: `http://nas${n}:8080`,
    addedAt: n,
    account: null,
  }))

/** The first light theme, which the default is not. */
const LIGHT_THEME = THEMES.find((theme) => theme.tone !== themeOf(DEFAULT_APP_PREFS.theme).tone)

describe('Settings on a phone or tablet', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    mockServer.asked = []
    useActiveServer.setState({ servers: [NAS, OTHER], activeId: NAS.id })
    useAccountState.setState({ signedIn: {}, version: 0 })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
  })

  describe('a server with accounts', () => {
    const ACCOUNT_NAS: AppServer = { ...NAS, account: PIN }
    const ACCOUNT_OTHER: AppServer = { ...OTHER, account: PIN }
    /** An answer the cache holds, whichever query it is. */
    const CACHED_KEY = ['home'] as const

    beforeEach(() => {
      useActiveServer.setState({ servers: [ACCOUNT_NAS, ACCOUNT_OTHER], activeId: NAS.id })
      useAccountState.setState({ signedIn: { [NAS.id]: true }, version: 1 })
    })

    it('offers Sign out only while its account is signed in', async () => {
      await renderScreen({ ui: <Settings /> })
      expect(screen.getByRole('button', { name: 'Sign out of nas:8080' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Sign out of other:8484' })).toBeNull()
    })

    it('signs out, keeping the server on the list with its pin, and asks nothing first', async () => {
      const alert = jest.spyOn(Alert, 'alert')
      await renderScreen({ ui: <Settings /> })
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out of nas:8080' }))
      await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ server: ACCOUNT_NAS }))
      expect(alert).not.toHaveBeenCalled()
      expect(useActiveServer.getState()).toMatchObject({
        servers: [ACCOUNT_NAS, ACCOUNT_OTHER],
        activeId: NAS.id,
      })
      expect(useAccountState.getState().signedIn[NAS.id]).toBe(false)
      expect(screen.queryByRole('button', { name: 'Sign out of nas:8080' })).toBeNull()
      expect(mockForget).not.toHaveBeenCalled()
    })

    it('empties the cache of the server in use as it signs out, so no other account sees its answers', async () => {
      const client = createScreenClient()
      const stop = clearOnSignOut({
        client,
        accounts: useAccountState,
        activeId: () => useActiveServer.getState().activeId,
      })
      client.setQueryData(CACHED_KEY, 'signed in')
      await renderScreen({ ui: <Settings />, client })
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out of nas:8080' }))
      await waitFor(() => expect(client.getQueryData(CACHED_KEY)).toBeUndefined())
      stop()
    })

    it('signs out of a server not in use, leaving the cache to the one that is', async () => {
      useAccountState.setState({ signedIn: { [NAS.id]: true, [OTHER.id]: true }, version: 2 })
      const client = createScreenClient()
      const stop = clearOnSignOut({
        client,
        accounts: useAccountState,
        activeId: () => useActiveServer.getState().activeId,
      })
      client.setQueryData(CACHED_KEY, 'signed in')
      await renderScreen({ ui: <Settings />, client })
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out of other:8484' }))
      await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ server: ACCOUNT_OTHER }))
      expect(client.getQueryData(CACHED_KEY)).toBe('signed in')
      expect(useAccountState.getState().signedIn[NAS.id]).toBe(true)
      stop()
    })
  })

  it('lists every server, the one in use marked, each with its ways to change it', async () => {
    await renderScreen({ ui: <Settings /> })
    expect(screen.getByRole('header', { name: 'Servers' })).toBeTruthy()
    expect(screen.getByText('nas:8080')).toBeTruthy()
    expect(screen.getByText('In use')).toBeTruthy()
    expect(screen.getByText('http://other:8484')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use nas:8080' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Use other:8484' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename nas:8080' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove other:8484' })).toBeTruthy()
  })

  it('switches servers: the cache is emptied and Home reads the new one', async () => {
    const client = createScreenClient()
    const stop = clearOnServerSwitch({ client, store: useActiveServer })
    await renderScreen({
      ui: (
        <>
          <Home />
          <Settings />
        </>
      ),
      client,
    })
    await screen.findByRole('header', { name: 'Films' })
    expect(mockServer.asked).toEqual([`${NAS.origin}${APP_CLIENT_CALLS.getHome.path}`])

    await fireEvent.press(screen.getByRole('button', { name: 'Use other:8484' }))
    expect(useActiveServer.getState().activeId).toBe(OTHER.id)
    expect(screen.queryByRole('header', { name: 'Films' })).toBeNull()
    expect(await screen.findByRole('header', { name: 'Cartoons' })).toBeTruthy()
    expect(mockServer.asked).toEqual([
      `${NAS.origin}${APP_CLIENT_CALLS.getHome.path}`,
      `${OTHER.origin}${APP_CLIENT_CALLS.getHome.path}`,
    ])
    expect(screen.getByRole('button', { name: 'Use nas:8080' })).toBeTruthy()
    stop()
  })

  it('removes the server in use once asked, forgetting its cookies and switching to another', async () => {
    const alert = answerAlert('Remove')
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Remove nas:8080' }))
    expect(alert).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockForget).toHaveBeenCalledWith(NAS.id))
    expect(useActiveServer.getState()).toMatchObject({ servers: [OTHER], activeId: OTHER.id })
    expect(screen.queryByText('nas:8080')).toBeNull()
  })

  it('leaves no server in use once the last goes, so sign-in follows', async () => {
    answerAlert('Remove')
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Remove nas:8080' }))
    await waitFor(() => expect(mockForget).toHaveBeenCalledWith(NAS.id))
    expect(useActiveServer.getState()).toMatchObject({ servers: [], activeId: null })
  })

  it('keeps the server when the removal is cancelled', async () => {
    answerAlert('Cancel')
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Remove nas:8080' }))
    expect(mockForget).not.toHaveBeenCalled()
    expect(useActiveServer.getState().servers).toEqual([NAS, OTHER])
  })

  it('renames a server, and says so when the name will not do', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Rename nas:8080' }))
    const field = screen.getByLabelText('Name')
    expect(field.props.value).toBe('nas:8080')

    await fireEvent.changeText(field, '   ')
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Give the server a name, up to 80 characters.')).toBeTruthy()

    await fireEvent.changeText(screen.getByLabelText('Name'), ' Living  room ')
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
    expect(useActiveServer.getState().servers[0]).toEqual({ ...NAS, name: 'Living room' })
    expect(await screen.findByRole('button', { name: 'Rename Living room' })).toBeTruthy()
  })

  it('leaves the name as it was when the rename is cancelled', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Rename nas:8080' }))
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Attic')
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
    expect(useActiveServer.getState().servers[0]).toEqual(NAS)
    expect(screen.getByRole('button', { name: 'Rename nas:8080' })).toBeTruthy()
  })

  it('adds a server through sign-in', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Add a server' }))
    expect(mockPush).toHaveBeenCalledWith(APP_ROUTES.signIn)
  })

  it('adds none once the list holds as many as a device keeps, and says so', async () => {
    const full = serversOf(SERVERS_CAP)
    useActiveServer.setState({ servers: full, activeId: full[0]?.id ?? null })
    await renderScreen({ ui: <Settings /> })
    const add = screen.getByRole('button', { name: 'Add a server' })
    expect(add.props.accessibilityState).toMatchObject({ disabled: true })
    await fireEvent.press(add)
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.getByText(`This device keeps ${SERVERS_CAP} servers at most.`)).toBeTruthy()
  })

  it("picks the theme from the system's sheet, every theme offered", async () => {
    if (LIGHT_THEME === undefined) throw new Error('No light theme')
    const asked = answerSheet(LIGHT_THEME.name)
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(
      screen.getByRole('button', { name: `Theme: ${themeOf(DEFAULT_APP_PREFS.theme).name}` }),
    )
    expect(asked).toEqual([
      { title: 'Theme', options: [...THEMES.map((theme) => theme.name), 'Cancel'] },
    ])
    expect(useAppPrefs.getState().theme).toBe(LIGHT_THEME.id)
    expect(screen.getByRole('button', { name: `Theme: ${LIGHT_THEME.name}` })).toBeTruthy()
  })

  it('wears a theme the moment it is picked: Home and Settings repaint, the logo with them', async () => {
    if (LIGHT_THEME === undefined) throw new Error('No light theme')
    const before = appThemeOf(DEFAULT_APP_PREFS.theme)
    const after = appThemeOf(LIGHT_THEME.id)
    const colourOf = (name: string): unknown =>
      StyleSheet.flatten(screen.getByRole('header', { name }).props.style)?.color ?? null
    answerSheet(LIGHT_THEME.name)
    await renderScreen({
      ui: (
        <>
          <Home />
          <Settings />
        </>
      ),
    })
    await screen.findByRole('header', { name: 'Films' })
    expect(colourOf('Home')).toBe(before.palette.text)
    expect(colourOf('Servers')).toBe(before.palette.text)
    expect(screen.getByRole('image', { name: 'raven' }).props.source).toBe(LOGO_MARKS[before.tone])

    await fireEvent.press(screen.getByRole('button', { name: `Theme: ${themeOf(before.id).name}` }))
    expect(colourOf('Home')).toBe(after.palette.text)
    expect(colourOf('Films')).toBe(after.palette.text)
    expect(colourOf('Servers')).toBe(after.palette.text)
    expect(after.palette.text).not.toBe(before.palette.text)
    expect(screen.getByRole('image', { name: 'raven' }).props.source).toBe(LOGO_MARKS[after.tone])
    expect(LOGO_MARKS[after.tone]).not.toBe(LOGO_MARKS[before.tone])
  })

  it('turns direct play preference and transcoding off and on', async () => {
    await renderScreen({ ui: <Settings /> })
    const direct = screen.getByRole('switch', { name: 'Prefer direct play' })
    const transcode = screen.getByRole('switch', { name: 'Allow transcoding' })
    expect(direct.props.value).toBe(true)
    expect(transcode.props.value).toBe(true)

    await fireEvent(direct, NATIVE_EVENTS.valueChange, false)
    await fireEvent(transcode, NATIVE_EVENTS.valueChange, false)
    expect(useAppPrefs.getState()).toMatchObject({
      shouldPreferDirectPlay: false,
      isTranscodeAllowed: false,
    })
    await fireEvent(
      screen.getByRole('switch', { name: 'Allow transcoding' }),
      NATIVE_EVENTS.valueChange,
      true,
    )
    expect(useAppPrefs.getState().isTranscodeAllowed).toBe(true)
  })

  it('caps the picture away from home at the height picked', async () => {
    const asked = answerSheet('720p')
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Away from home: 1080p' }))
    expect(asked.map(({ options }) => options)).toEqual([['4K', '1080p', '720p', 'Cancel']])
    expect(useAppPrefs.getState().awayMaxHeight).toBe(MAX_HEIGHTS.hd)
  })

  it('goes back from its Back', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalled()
  })
})
