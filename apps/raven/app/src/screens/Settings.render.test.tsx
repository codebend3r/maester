import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { APP_CLIENT_CALLS, MAX_HEIGHTS, THEMES, themeOf } from '@raven/core'
import { fireEvent, screen } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet, processColor } from 'react-native'

import { LAUNCH_LOOK, LOGO_TEST_IDS, logoColoursOf } from '@/layouts/Logo'
import { Home } from '@/screens/Home'
import { Settings } from '@/screens/Settings'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { NAS, OTHER, homeApi } from '@/test/homeServer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { renderScreen } from '@/test/renderScreen'
import { appThemeOf } from '@/theme/appTheme'

const mockBack = jest.fn()
/** The paths each server was asked for, by its origin. */
const mockAsked: string[] = []
const mockApi = jest.fn((server: AppServer) => {
  const api = homeApi(server)
  return {
    ...api,
    getHome: async () => {
      mockAsked.push(`${server.origin}${APP_CLIENT_CALLS.getHome.path}`)
      return api.getHome()
    },
  }
})

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }))
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: AppServer) => mockApi(server),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

/** The system sheet a touch picker opens, answered with the option named `answer`. */
const answerSheet = (answer: string) => {
  const asked: { title: string; options: string[] }[] = []
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
    asked.push({ title: options.title ?? '', options: options.options })
    done(options.options.indexOf(answer))
  })
  return asked
}

/** The first light theme, which the default is not. */
const LIGHT_THEME = THEMES.find((theme) => theme.tone !== themeOf(DEFAULT_APP_PREFS.theme).tone)

describe('Settings on a phone or tablet', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    mockAsked.length = 0
    useActiveServer.setState({ servers: [NAS, OTHER], activeId: NAS.id })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
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
    /** What the mark's body is painted with: the brush react-native-svg hands the native path. */
    const markBody = (): unknown => screen.getByTestId(LOGO_TEST_IDS.body).props.fill
    const brushOf = (colour: string): object => ({ payload: processColor(colour) })
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
    expect(colourOf('Settings')).toBe(before.palette.text)
    expect(markBody()).toMatchObject(
      brushOf(logoColoursOf({ look: LAUNCH_LOOK, theme: before }).body),
    )

    await fireEvent.press(screen.getByRole('button', { name: `Theme: ${themeOf(before.id).name}` }))
    expect(colourOf('Home')).toBe(after.palette.text)
    expect(colourOf('Films')).toBe(after.palette.text)
    expect(colourOf('Settings')).toBe(after.palette.text)
    expect(after.palette.text).not.toBe(before.palette.text)
    expect(markBody()).toMatchObject(
      brushOf(logoColoursOf({ look: LAUNCH_LOOK, theme: after }).body),
    )
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
