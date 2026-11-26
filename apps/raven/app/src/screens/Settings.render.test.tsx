import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CLIENT_CALLS,
  CAPTION_COLOURS,
  CAPTION_SIZES,
  ITEM_TYPES,
  MAX_HEIGHTS,
  REQUEST_STATUSES,
  THEMES,
  type TitleRequests,
  themeOf,
} from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { ActionSheetIOS, StyleSheet, processColor } from 'react-native'

import { LAUNCH_LOOK, LOGO_TEST_IDS, logoColoursOf } from '@/layouts/Logo'
import { APP_ROUTES } from '@/routes'
import { Home } from '@/screens/Home'
import { Settings } from '@/screens/Settings'
import { useActiveServer } from '@/stores/activeServer'
import { DEFAULT_APP_PREFS, useAppPrefs } from '@/stores/appPrefs'
import { NAS, OTHER, homeApi } from '@/test/homeServer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import { renderScreen } from '@/test/renderScreen'
import { appThemeOf } from '@/theme/appTheme'

const mockBack = jest.fn()
const mockDismissTo = jest.fn()
/** The paths each server was asked for, by its origin. */
const mockAsked: string[] = []
/** What the server answers for the caller's requests. */
const REQUESTS: TitleRequests = {
  requests: [
    {
      type: ITEM_TYPES.movie,
      tmdbId: '438631',
      title: 'Dune',
      status: REQUEST_STATUSES.searching,
      requestedAt: '2026-11-20T15:00:00.000Z',
      isMine: true,
    },
    {
      type: ITEM_TYPES.show,
      tmdbId: '1399',
      title: 'Not mine',
      status: REQUEST_STATUSES.downloading,
      requestedAt: '2026-11-21T15:00:00.000Z',
      isMine: false,
    },
  ],
  budget: { limit: 5, left: 3, nextAt: null },
  kinds: { movie: true, show: true },
}
const mockApi = jest.fn((server: AppServer) => {
  const api = homeApi(server)
  return {
    ...api,
    listRequests: async () => REQUESTS,
    getHome: async () => {
      mockAsked.push(`${server.origin}${APP_CLIENT_CALLS.getHome.path}`)
      return api.getHome()
    },
  }
})

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, dismissTo: mockDismissTo }),
}))
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

/** The system sheet a touch picker opens, answered with the option named `answer`. */
const answerSheet = (answer: string) => {
  const asked: { title: string; options: string[] }[] = []
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
    asked.push({ title: options.title ?? '', options: options.options })
    done(options.options.indexOf(answer))
  })
  return asked
}

/** Opens one of Settings' tabs by its name. */
const openTab = (name: string) => fireEvent.press(screen.getByRole('tab', { name }))

/** The first light theme, which the default is not. */
const LIGHT_THEME = THEMES.find((theme) => theme.tone !== themeOf(DEFAULT_APP_PREFS.theme).tone)

describe('Settings on a phone or tablet', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    mockAsked.length = 0
    useActiveServer.setState({ servers: [NAS, OTHER], activeId: NAS.id })
    useAppPrefs.setState(DEFAULT_APP_PREFS)
    usePlayerPrefs.setState(usePlayerPrefs.getInitialState())
  })

  it('takes the viewer Home from the header without stacking another screen', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Home' }))
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it("lays its settings out in the web's tabs, opening on Playback", async () => {
    await renderScreen({ ui: <Settings /> })
    const tabs = await waitFor(() => {
      const shown = screen.getAllByRole('tab')
      expect(shown.at(-1)?.props.accessibilityLabel).toBe('Requests, 1')
      return shown
    })
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Playback',
      'Subtitles',
      'Servers',
      'Account',
      'This app',
      'Advanced',
      'Requests, 1',
    ])
    expect(screen.getByRole('tab', { name: 'Playback' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()

    await openTab('Account')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Prefer direct play' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Account' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
  })

  it("turns autoplay and skipping intros off, and sets the up next countdown, in the player's preferences", async () => {
    const asked = answerSheet('30 seconds')
    await renderScreen({ ui: <Settings /> })
    await fireEvent(
      screen.getByRole('switch', { name: 'Autoplay' }),
      NATIVE_EVENTS.valueChange,
      false,
    )
    await fireEvent(
      screen.getByRole('switch', { name: 'Skip intros automatically' }),
      NATIVE_EVENTS.valueChange,
      false,
    )
    await fireEvent.press(
      screen.getByRole('button', { name: /^Count down to what is up next for: / }),
    )
    expect(asked.at(-1)?.options.slice(0, 3)).toEqual(['5 seconds', '10 seconds', '15 seconds'])
    expect(usePlayerPrefs.getState()).toMatchObject({
      autoplay: false,
      autoSkipIntro: false,
      autoplayCountdownSeconds: 30,
    })
  })

  it("sets how long the player's controls linger under Advanced", async () => {
    answerSheet('8 seconds')
    await renderScreen({ ui: <Settings /> })
    await openTab('Advanced')
    await fireEvent.press(
      screen.getByRole('button', { name: /^Hide the player's controls after: / }),
    )
    expect(usePlayerPrefs.getState().controlsLingerSeconds).toBe(8)
  })

  it("lists the caller's own requests and where each stands", async () => {
    await renderScreen({ ui: <Settings /> })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Requests, 1' })).toBeTruthy())
    await openTab('Requests, 1')
    expect(await screen.findByLabelText(/^Dune: /u)).toBeTruthy()
    expect(screen.queryByLabelText(/^Not mine: /u)).toBeNull()
    expect(screen.getByText('3 of 5 requests left today')).toBeTruthy()
  })

  it("picks the theme from the system's sheet, every theme offered", async () => {
    if (LIGHT_THEME === undefined) throw new Error('No light theme')
    const asked = answerSheet(LIGHT_THEME.name)
    await renderScreen({ ui: <Settings /> })
    await openTab('This app')
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
    await openTab('This app')
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

  it('keeps the subtitle size and colour picked on this device alone', async () => {
    const asked = answerSheet('Largest')
    await renderScreen({ ui: <Settings /> })
    await openTab('Subtitles')
    await fireEvent.press(await screen.findByRole('button', { name: 'Size: Medium' }))
    expect(asked.map(({ options }) => options)).toEqual([
      ['Small', 'Medium', 'Large', 'Largest', 'Cancel'],
    ])
    expect(await screen.findByRole('button', { name: 'Size: Largest' })).toBeTruthy()
    answerSheet('Yellow')
    await fireEvent.press(screen.getByRole('button', { name: 'Colour: White' }))
    await waitFor(() =>
      expect(usePlayerPrefs.getState().captionStyle).toEqual({
        size: CAPTION_SIZES.largest,
        colour: CAPTION_COLOURS.yellow,
      }),
    )
  })

  it('goes back from its Back', async () => {
    await renderScreen({ ui: <Settings /> })
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalled()
  })
})
