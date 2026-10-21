import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { LockState } from '@raven/core'
import { fireEvent, render, screen } from '@testing-library/react-native'

import { SignIn } from '@/screens/SignIn'
import { useActiveServer } from '@/stores/activeServer'
import { NATIVE_EVENTS } from '@/test/nativeEvents'
import type * as NavigationFocus from '@/test/navigationFocus'
import { askedFor, resetTestScreen } from '@/test/navigationFocus'

const mockGetLock = jest.fn<() => Promise<LockState>>()

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
  apiFor: () => ({ getLock: mockGetLock }),
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
})
