import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type * as Native from '@raven/native'
import { AUTH_OUTCOMES, type AuthOutcome } from '@raven/native/headless'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { useAccountSession } from '@/account/session'
import { SignIn } from '@/screens/SignIn'
import { useActiveServer } from '@/stores/activeServer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'

type MockSignInCallbackProps = { email: string; password: string }

const mockSignIn = jest.fn<(input: MockSignInCallbackProps) => Promise<AuthOutcome>>()

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
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => ({
    getHome: async () => ({ inProgress: [], shelves: [] }),
    getMediaTicket: async () => ({ ticket: 't', expiresAt: 1 }),
  }),
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
    useAccountSession.setState({ signIn: mockSignIn })
    mockSignIn.mockResolvedValue({
      kind: AUTH_OUTCOMES.ok,
      session: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: 1,
        userId: 'u1',
        email: 'viewer@example.com',
      },
    })
  })

  // Asked for as it mounts, the preferred focus comes before the field is in the window, which
  // on Android TV left the step with nothing focused.
  it('asks for the remote on the field once it is drawn', async () => {
    await render(<SignIn />)
    expect(askedFor()).toEqual(['Email'])

    await fireEvent(screen.getByLabelText('Email'), NATIVE_EVENTS.endEditing, {
      nativeEvent: { text: 'viewer@example.com' },
    })
    await fireEvent(screen.getByLabelText('Password'), NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: 'hunter2' },
    })
    await waitFor(() => expect(mockSignIn).toHaveBeenCalled())
    // No other step asks for the remote.
    expect(askedFor()).toEqual(['Email'])
  })

  it('drops what was typed when Menu cancels the keyboard, as the field does', async () => {
    await render(<SignIn />)
    const field = screen.getByLabelText('Email')
    await fireEvent.changeText(field, 'viewer@exa')
    // tvOS reports each key as it is typed, then puts the field back on Menu, saying so
    // only as the edit ends.
    await fireEvent(field, NATIVE_EVENTS.endEditing, { nativeEvent: { text: '' } })
    expect(screen.getByLabelText('Email').props.value).toBe('')

    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email and password.')).toBeTruthy()
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('keeps what was typed when the keyboard sends it', async () => {
    await render(<SignIn />)
    const field = screen.getByLabelText('Email')
    await fireEvent.changeText(field, 'viewer@example.com')
    await fireEvent(field, NATIVE_EVENTS.endEditing, {
      nativeEvent: { text: 'viewer@example.com' },
    })
    expect(screen.getByLabelText('Email').props.value).toBe('viewer@example.com')
  })

  it('signs in with the password the keyboard sends, though its last keys have not reached the field', async () => {
    await render(<SignIn />)
    await fireEvent(screen.getByLabelText('Email'), NATIVE_EVENTS.endEditing, {
      nativeEvent: { text: 'viewer@example.com' },
    })
    const field = screen.getByLabelText('Password')
    await fireEvent.changeText(field, 'hunt')
    await fireEvent(field, NATIVE_EVENTS.submitEditing, { nativeEvent: { text: 'hunter2' } })
    expect(mockSignIn).toHaveBeenCalledWith({ email: 'viewer@example.com', password: 'hunter2' })
  })
})
