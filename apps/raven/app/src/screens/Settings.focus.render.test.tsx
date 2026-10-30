import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MAX_HEIGHTS, THEMES, themeOf } from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import { fireEvent, screen, within } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet } from 'react-native'

import { Settings } from '@/screens/Settings'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { NAS, OTHER, homeApi } from '@/test/homeServer'
import type * as NavigationFocus from '@/test/navigationFocus'
import { resetTestScreen } from '@/test/navigationFocus'
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

jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').navigationFocusMocks,
  useRouter: () => ({ push: mockPush, back: mockBack }),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: ({ server }: ApiForProps) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
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

  it('opens with the remote on the first button, and only as it opens', async () => {
    await renderScreen({ ui: <Settings /> })
    expect(preferred()).toEqual(['Sign out'])

    await fireEvent(screen.getByRole('button', { name: 'Sign out' }), NATIVE_EVENTS.focus)
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

    expect(styleOf(screen.getByRole('header', { name: 'Settings' }))?.color ?? null).toBe(
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
})
