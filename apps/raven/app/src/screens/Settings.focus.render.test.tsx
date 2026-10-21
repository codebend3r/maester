import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MAX_HEIGHTS, THEMES, themeOf } from '@raven/core'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet } from 'react-native'

import { Settings } from '@/screens/Settings'
import { SIGN_IN_COPY, SignIn } from '@/screens/SignIn'
import type { AppServer } from '@/servers/serverList'
import { useAccountAnswers } from '@/stores/accountAnswers'
import { noteSession, useAccountState } from '@/stores/accountState'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { PIN } from '@/test/accountPins'
import { heldAnswer } from '@/test/heldAnswer'
import { NAS, OTHER, homeApi } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { renderScreen } from '@/test/renderScreen'
import { appThemeOf } from '@/theme/appTheme'

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
const mockPush = jest.fn()
const mockBack = jest.fn()
const mockApi = jest.fn(homeApi)
/** Ends the sign-in as the sessions do: the app hears the server is signed out. */
const mockSignOut = jest.fn(async ({ server }: { server: AppServer }) => {
  noteSession({ serverId: server.id, isSignedIn: false })
})

jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').navigationFocusMocks,
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    dismissTo: jest.fn(),
    canGoBack: () => false,
  }),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
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

/** Whatever on screen asks for the remote's focus, by its label. */
const preferred = (): unknown[] =>
  [...screen.getAllByRole('button'), ...screen.getAllByRole('switch')]
    .filter((node) => node.props.hasTVPreferredFocus === true)
    .map((node) => node.props.accessibilityLabel)

const DEFAULT_THEME_NAME = themeOf(DEFAULT_APP_PREFS.theme).name

describe('Settings on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useActiveServer.setState({ servers: [NAS, OTHER], activeId: NAS.id })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
  })

  it("opens with the remote on the first server's first control, and only as it opens", async () => {
    await renderScreen({ ui: <Settings /> })
    expect(preferred()).toEqual(['Rename nas:8080'])

    await fireEvent(screen.getByRole('button', { name: 'Rename nas:8080' }), NATIVE_EVENTS.focus)
    expect(preferred()).toEqual([])
  })

  it('lets go of the opening focus for whatever the remote reaches first', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent(screen.getByRole('switch', { name: 'Prefer direct play' }), NATIVE_EVENTS.focus)
    expect(preferred()).toEqual([])
  })

  it('picks the theme from a list the remote moves through, on the theme in use', async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    const light = THEMES.find((theme) => theme.tone !== themeOf(DEFAULT_APP_PREFS.theme).tone)
    if (light === undefined) throw new Error('No light theme')
    await renderScreen({ ui: <Settings /> })

    await fireEvent.press(screen.getByRole('button', { name: `Theme: ${DEFAULT_THEME_NAME}` }))
    const list = within(screen.getByLabelText('Theme'))
    const options = list.getAllByRole('button')
    expect(options.map((option) => option.props.accessibilityLabel)).toEqual(
      THEMES.map((theme) => theme.name),
    )
    expect(
      options
        .filter((option) => option.props.hasTVPreferredFocus === true)
        .map((option) => option.props.accessibilityLabel),
    ).toEqual([DEFAULT_THEME_NAME])

    await fireEvent.press(list.getByRole('button', { name: light.name }))
    expect(sheet).not.toHaveBeenCalled()
    expect(useAppPrefs.getState().theme).toBe(light.id)
  })

  it('wears a theme the moment it is picked: the page, its plates and the focus ring', async () => {
    const light = THEMES.find((theme) => theme.tone !== themeOf(DEFAULT_APP_PREFS.theme).tone)
    if (light === undefined) throw new Error('No light theme')
    const { palette } = appThemeOf(light.id)
    const styleOf = (node: ReturnType<typeof screen.getByRole>) =>
      StyleSheet.flatten(node.props.style)
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: `Theme: ${DEFAULT_THEME_NAME}` }))
    await fireEvent.press(
      within(screen.getByLabelText('Theme')).getByRole('button', { name: light.name }),
    )

    expect(styleOf(screen.getByRole('header', { name: 'Servers' }))?.color ?? null).toBe(
      palette.text,
    )
    const theme = screen.getByRole('button', { name: `Theme: ${light.name}` })
    expect(styleOf(theme)?.backgroundColor ?? null).toBe(palette.quiet)
    await fireEvent(theme, NATIVE_EVENTS.focus)
    expect(
      styleOf(screen.getByRole('button', { name: `Theme: ${light.name}` }))?.borderColor ?? null,
    ).toBe(palette.text)
  })

  it('turns a setting on and off with a press, saying which it is', async () => {
    await renderScreen({ ui: <Settings /> })
    const transcode = screen.getByRole('switch', { name: 'Allow transcoding' })
    expect(transcode.props.accessibilityState).toMatchObject({ checked: true })
    await fireEvent.press(transcode)
    expect(useAppPrefs.getState().isTranscodeAllowed).toBe(false)
    expect(
      screen.getByRole('switch', { name: 'Allow transcoding' }).props.accessibilityState,
    ).toMatchObject({ checked: false })
  })

  it('caps the picture away from home from the same list', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Away from home: 1080p' }))
    await fireEvent.press(
      within(screen.getByLabelText('Away from home')).getByRole('button', { name: '4K' }),
    )
    expect(useAppPrefs.getState().awayMaxHeight).toBe(MAX_HEIGHTS.uhd)
  })

  it('renames a server through the TV keyboard, starting on its field', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Rename other:8484' }))
    const field = screen.getByLabelText('Name')
    expect(field.props.hasTVPreferredFocus).toBe(true)
    await fireEvent(field, NATIVE_EVENTS.endEditing, { nativeEvent: { text: 'Den' } })
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
    expect(useActiveServer.getState().servers[1]).toEqual({ ...OTHER, name: 'Den' })
  })

  it("comes back from a rename with the remote on that server's Rename, saved or not", async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent(screen.getByRole('button', { name: 'Rename nas:8080' }), NATIVE_EVENTS.focus)
    await fireEvent.press(screen.getByRole('button', { name: 'Rename other:8484' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
    expect(preferred()).toEqual(['Rename other:8484'])

    await fireEvent(screen.getByRole('button', { name: 'Rename other:8484' }), NATIVE_EVENTS.focus)
    await fireEvent.press(screen.getByRole('button', { name: 'Rename other:8484' }))
    await fireEvent(screen.getByLabelText('Name'), NATIVE_EVENTS.endEditing, {
      nativeEvent: { text: 'Den' },
    })
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
    expect(preferred()).toEqual(['Rename Den'])
  })

  it("cancels a rename on Menu or Back, staying on Settings with the remote on that server's Rename", async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent(screen.getByRole('button', { name: 'Rename nas:8080' }), NATIVE_EVENTS.focus)
    await fireEvent.press(screen.getByRole('button', { name: 'Rename other:8484' }))
    await fireEvent(screen.getByLabelText('Name'), NATIVE_EVENTS.endEditing, {
      nativeEvent: { text: 'Den' },
    })

    await fireEvent(screen.getByLabelText('Name'), NATIVE_EVENTS.requestClose)
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.getByRole('header', { name: 'Settings' })).toBeTruthy()
    expect(mockBack).not.toHaveBeenCalled()
    expect(useActiveServer.getState().servers[1]).toEqual(OTHER)
    expect(preferred()).toEqual(['Rename other:8484'])
  })
  describe('signing out', () => {
    const ACCOUNT_NAS: AppServer = { ...NAS, account: PIN }
    const ACCOUNT_OTHER: AppServer = { ...OTHER, account: PIN }

    /** Settings while the server in use is signed in, then sign-in, as the routes' guard does. */
    const Guarded = () => {
      const isSignedIn = useAccountState((state) => state.signedIn[NAS.id] === true)
      return isSignedIn ? <Settings /> : <SignIn />
    }

    beforeEach(() => {
      useActiveServer.setState({ servers: [ACCOUNT_NAS, ACCOUNT_OTHER], activeId: NAS.id })
      useAccountAnswers.setState({ answers: {} })
      useAccountState.setState({ signedIn: { [NAS.id]: true, [OTHER.id]: true }, version: 2 })
    })

    it("lands the remote on the account step's Email, once, after signing out of the server in use", async () => {
      await renderScreen({ ui: <Guarded /> })
      await fireEvent(screen.getByRole('button', { name: 'Rename nas:8080' }), NATIVE_EVENTS.focus)
      await fireEvent(
        screen.getByRole('button', { name: 'Sign out of nas:8080' }),
        NATIVE_EVENTS.focus,
      )
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out of nas:8080' }))

      expect(await screen.findByText(SIGN_IN_COPY.accountPrompt)).toBeTruthy()
      expect(mockSignOut).toHaveBeenCalledWith({ server: ACCOUNT_NAS })
      expect(askedFor()).toEqual([SIGN_IN_COPY.email])
      const email = screen.getByLabelText(SIGN_IN_COPY.email)
      expect(email.props.hasTVPreferredFocus).toBe(true)

      await fireEvent(email, NATIVE_EVENTS.focus)
      await fireEvent(screen.getByLabelText(SIGN_IN_COPY.password), NATIVE_EVENTS.focus)
      expect(screen.getByLabelText(SIGN_IN_COPY.email).props.hasTVPreferredFocus).toBe(false)
      expect(askedFor()).toEqual([SIGN_IN_COPY.email])
      expect(useActiveServer.getState().servers).toEqual([ACCOUNT_NAS, ACCOUNT_OTHER])
    })

    it("hands the remote to the row's first button once its Sign out goes, for a server not in use", async () => {
      await renderScreen({ ui: <Guarded /> })
      const signOut = screen.getByRole('button', { name: 'Sign out of other:8484' })
      await fireEvent(signOut, NATIVE_EVENTS.focus)
      await fireEvent.press(signOut)

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Sign out of other:8484' })).toBeNull(),
      )
      expect(askedFor()).toEqual(['Use other:8484'])
      expect(screen.getByRole('header', { name: 'Settings' })).toBeTruthy()
    })

    it('asks for nothing once the remote has moved on along the row before the sign out ends', async () => {
      const held = heldAnswer()
      mockSignOut.mockImplementationOnce(async ({ server }) => {
        await held.answer
        noteSession({ serverId: server.id, isSignedIn: false })
      })
      await renderScreen({ ui: <Guarded /> })
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out of other:8484' }))
      await fireEvent(screen.getByRole('button', { name: 'Use other:8484' }), NATIVE_EVENTS.focus)
      await act(async () => held.release())
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Sign out of other:8484' })).toBeNull(),
      )
      expect(askedFor()).toEqual([])
    })
  })
})
