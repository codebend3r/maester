import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AUTH_CONFIG_STATES, type AuthConfig, type LockState } from '@raven/core'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { Alert } from 'react-native'

import { SIGN_IN_COPY, SignIn } from '@/screens/SignIn'
import { MEDIA_ACCESS_MESSAGES } from '@/servers/mediaAccess'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import { MOVED_PIN, PIN, readyConfigOf } from '@/test/accountPins'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'

const mockGetLock = jest.fn<() => Promise<LockState>>()
const mockGetAuthConfig = jest.fn<() => Promise<AuthConfig>>()

// The layouts pick their variant once, as they load, so the TV is set before anything does.
jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const platform = jest.requireActual<{ default: object }>(
    'react-native/Libraries/Utilities/Platform',
  )
  Object.defineProperty(platform.default, 'isTV', { get: () => true })
  return platform
})
jest.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: jest.fn(), back: jest.fn(), canGoBack: () => false }),
}))
jest.mock(
  '@/layouts/tvFocus',
  () => jest.requireActual<typeof NavigationFocus>('@/test/navigationFocus').tvFocusMocks,
)
jest.mock('@/servers/serverClient', () => ({
  apiFor: () => ({ getLock: mockGetLock, getAuthConfig: mockGetAuthConfig }),
  newServerId: () => '0f8fad5b-d9cb-469f-a165-70867728950e',
  cookieJar: { forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('SignIn on a TV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetTestScreen()
    useActiveServer.setState({ servers: [], activeId: null })
    mockGetLock.mockResolvedValue({ available: false, unlocked: false })
    mockGetAuthConfig.mockResolvedValue({ state: AUTH_CONFIG_STATES.off })
  })

  // Asked for as it mounts, the preferred focus comes before the field is in the window, which
  // on Android TV left the step with nothing focused.
  it('asks for the remote on the field of each step once it is drawn', async () => {
    mockGetLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    expect(askedFor()).toEqual(['Server address'])

    const field = screen.getByLabelText('Server address')
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: 'http://127.0.0.1:8490' },
    })
    expect(await screen.findByLabelText('PIN')).toBeTruthy()
    expect(askedFor()).toEqual(['Server address', 'PIN'])
  })

  it('drops what was typed when Menu cancels the keyboard, as the field does', async () => {
    await render(<SignIn />)
    const field = screen.getByLabelText('Server address')
    await fireEvent.changeText(field, 'http://127.0.0.1:8490')
    // tvOS reports each key as it is typed, then puts the field back on Menu, saying so
    // only as the edit ends.
    await fireEvent(field, NATIVE_EVENTS.endEditing, { nativeEvent: { text: '' } })
    expect(screen.getByLabelText('Server address').props.value).toBe('')

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Enter the server's address on its own/)).toBeTruthy()
    expect(mockGetLock).not.toHaveBeenCalled()
  })

  it('keeps what was typed when the keyboard sends it', async () => {
    await render(<SignIn />)
    const field = screen.getByLabelText('Server address')
    await fireEvent.changeText(field, 'http://127.0.0.1:8490')
    await fireEvent(field, NATIVE_EVENTS.endEditing, {
      nativeEvent: { text: 'http://127.0.0.1:8490' },
    })
    expect(screen.getByLabelText('Server address').props.value).toBe('http://127.0.0.1:8490')

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(mockGetLock).toHaveBeenCalledTimes(1)
  })

  it('signs in to what the keyboard sends, though its last keys have not reached the field', async () => {
    await render(<SignIn />)
    const field = screen.getByLabelText('Server address')
    await fireEvent.changeText(field, 'http:/')
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: 'http://127.0.0.1:8490' },
    })
    expect(mockGetLock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Enter the server's address on its own/)).toBeNull()
  })

  describe('a pinned server whose sign-in names other endpoints', () => {
    const KNOWN: AppServer = {
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      name: 'nas',
      origin: 'http://127.0.0.1:8490',
      addedAt: 1,
      account: PIN,
    }

    const reachQuestion = async () => {
      useActiveServer.setState({ servers: [KNOWN], activeId: KNOWN.id })
      mockGetAuthConfig.mockResolvedValue(readyConfigOf(MOVED_PIN))
      await render(<SignIn />)
      await fireEvent(screen.getByLabelText('Server address'), NATIVE_EVENTS.submitEditing, {
        nativeEvent: { text: KNOWN.origin },
      })
      expect(
        await screen.findByText(SIGN_IN_COPY.moved({ name: 'nas', host: 'moved.supabase.co' })),
      ).toBeTruthy()
    }

    it('asks on the form, with the remote on Cancel once it is drawn, not in an alert', async () => {
      const alert = jest.spyOn(Alert, 'alert')
      await reachQuestion()
      expect(screen.getByText(SIGN_IN_COPY.movedDetail)).toBeTruthy()
      expect(askedFor()).toEqual(['Server address', SIGN_IN_COPY.cancel])
      expect(alert).not.toHaveBeenCalled()
    })

    it('keeps the old pin on Cancel and says where the sign-in stays', async () => {
      await reachQuestion()
      await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.cancel }))
      expect(
        await screen.findByText(SIGN_IN_COPY.kept({ name: 'nas', host: 'project.supabase.co' })),
      ).toBeTruthy()
      expect(useActiveServer.getState().servers).toEqual([KNOWN])
      expect(askedFor()).toEqual(['Server address', SIGN_IN_COPY.cancel, 'Server address'])
    })

    it('pins the new endpoints on Use it', async () => {
      await reachQuestion()
      await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.follow }))
      expect(await screen.findByText(MEDIA_ACCESS_MESSAGES.account('nas'))).toBeTruthy()
      expect(useActiveServer.getState().servers).toEqual([{ ...KNOWN, account: MOVED_PIN }])
      expect(mockGetLock).not.toHaveBeenCalled()
    })
  })
})
