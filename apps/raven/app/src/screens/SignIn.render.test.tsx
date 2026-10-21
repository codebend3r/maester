import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  ADMIN_LOCK_STATES,
  AUTH_CONFIG_STATES,
  type AdminLock,
  ApiError,
  type AuthConfig,
  DEFAULT_THEME,
  type Home,
  type LockState,
  type MediaTicket,
  SERVERS_CAP,
  SIGN_IN_MESSAGES,
  SIGN_IN_OUTCOMES,
  type SignInOutcomeKind,
  AUTH_ROUTES,
} from '@raven/core'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { Alert, type AlertButton, Linking, StyleSheet } from 'react-native'

import type { AccountSessions } from '@/accounts/accountSessions'
import { APP_ROUTES } from '@/routes'
import { SIGN_IN_COPY, SignIn, TICKETS_OFF } from '@/screens/SignIn'
import { ACCOUNT_ANSWERS } from '@/servers/authConfigs'
import type { AppServer } from '@/servers/serverList'
import { useAccountAnswers } from '@/stores/accountAnswers'
import { useAccountState } from '@/stores/accountState'
import { useActiveServer } from '@/stores/activeServer'
import { MOVED_PIN, PIN, readyConfigOf } from '@/test/accountPins'
import { appThemeOf } from '@/theme/appTheme'
import { mediaItemFor } from '@/test/mediaItem'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

const MOCK_SERVER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const HOME: Home = { inProgress: [{ media: mediaItemFor({ id: 7 }), poster: null }], shelves: [] }

const mockDismissTo = jest.fn<(href: string) => void>()
const getLock = jest.fn<() => Promise<LockState>>()
const unlock = jest.fn<(pin: string) => Promise<LockState>>()
const getHome = jest.fn<() => Promise<Home>>()
const getMediaTicket = jest.fn<(id: number) => Promise<MediaTicket>>()
const getAdminLock = jest.fn<() => Promise<AdminLock>>()
const unlockAdmin = jest.fn<(password: string) => Promise<AdminLock>>()
const getAuthConfig = jest.fn<() => Promise<AuthConfig>>()
const mockApiFor = jest.fn((_server: unknown) => ({
  getAuthConfig,
  getLock,
  unlock,
  getAdminLock,
  unlockAdmin,
  getHome,
  getMediaTicket,
}))
const mockNewServerId = jest.fn(() => MOCK_SERVER_ID)
const mockForget = jest.fn(async (_serverId: string) => {})
type SignInInput = Parameters<AccountSessions['signIn']>[0]
const mockSignIn = jest.fn(async (_input: SignInInput): Promise<SignInOutcomeKind> => {
  return SIGN_IN_OUTCOMES.signedIn
})
const mockForgetSession = jest.fn(async (_input: { serverId: string }) => {})

const mockBack = jest.fn()
const mockCanGoBack = jest.fn(() => false)

jest.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: mockDismissTo, back: mockBack, canGoBack: mockCanGoBack }),
}))
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: unknown) => mockApiFor(server),
  newServerId: () => mockNewServerId(),
  cookieJar: { forget: (serverId: string) => mockForget(serverId) },
  accountSessions: {
    signIn: (input: SignInInput) => mockSignIn(input),
    forget: (input: { serverId: string }) => mockForgetSession(input),
  },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const enterAddress = async (address: string) => {
  await fireEvent.changeText(screen.getByLabelText('Server address'), address)
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
}

describe('SignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [], activeId: null })
    getHome.mockResolvedValue(HOME)
    getMediaTicket.mockResolvedValue({ ticket: 't', expiresAt: 1 })
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    getAuthConfig.mockResolvedValue({ state: AUTH_CONFIG_STATES.off })
    useAccountAnswers.setState({ answers: {} })
    useAccountState.setState({ signedIn: {}, version: 0 })
    mockSignIn.mockResolvedValue(SIGN_IN_OUTCOMES.signedIn)
    mockNewServerId.mockImplementation(() => MOCK_SERVER_ID)
    mockCanGoBack.mockReturnValue(false)
  })

  it('offers no way back on the first launch, where there is nothing to go back to', async () => {
    await render(<SignIn />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('goes back to Settings on Cancel when a server is added from there', async () => {
    mockCanGoBack.mockReturnValue(true)
    await render(<SignIn />)
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockBack).toHaveBeenCalled()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  const unlockWithPin = async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    unlock.mockResolvedValue({ available: true, unlocked: true })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '1234')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))
  }

  it('asks for the admin password after the PIN when the admin lock holds, then goes Home', async () => {
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.on, available: true })
    unlockAdmin.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    await unlockWithPin()

    await fireEvent.changeText(await screen.findByLabelText('Admin password'), 'Pass#word2026')
    expect(mockDismissTo).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(unlockAdmin).toHaveBeenCalledWith('Pass#word2026')
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('goes on without the admin password on Not now', async () => {
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.on, available: true })
    await unlockWithPin()
    await screen.findByLabelText('Admin password')
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }))
    expect(unlockAdmin).not.toHaveBeenCalled()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it("shows the server's words for a wrong admin password", async () => {
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.on, available: true })
    unlockAdmin.mockRejectedValue(
      new ApiError({ status: 401, message: 'That password is not right.' }),
    )
    await unlockWithPin()
    await fireEvent.changeText(await screen.findByLabelText('Admin password'), 'wrong')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('That password is not right.')).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it.each([
    ['off', { state: ADMIN_LOCK_STATES.off }],
    ['on with no password set', { state: ADMIN_LOCK_STATES.on, available: false }],
  ])('asks for no admin password when the admin lock is %s', async (_name, lock: AdminLock) => {
    getAdminLock.mockResolvedValue(lock)
    await unlockWithPin()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
    expect(screen.queryByLabelText('Admin password')).toBeNull()
  })

  it('reads the admin lock only after a PIN, never on Not now', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    await screen.findByLabelText('PIN')
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }))
    expect(getAdminLock).not.toHaveBeenCalled()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it("forgets a new server's cookies when the viewer starts over", async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    await screen.findByLabelText('PIN')
    await fireEvent.press(screen.getByRole('button', { name: 'Use another address' }))
    expect(mockForget).toHaveBeenCalledWith(MOCK_SERVER_ID)
    expect(await screen.findByLabelText('Server address')).toBeTruthy()
  })

  it('submits the address once while a submit is still running', async () => {
    getLock.mockReturnValue(new Promise(() => {}))
    await render(<SignIn />)
    const field = screen.getByLabelText('Server address')
    await fireEvent.changeText(field, 'http://nas:8080')
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: 'http://nas:8080' },
    })
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: 'http://nas:8080' },
    })
    expect(getLock).toHaveBeenCalledTimes(1)
  })

  it('fills only Unlock as the primary action; Not now is quiet and another address bare', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    await screen.findByLabelText('PIN')
    const fillOf = (name: string): unknown =>
      StyleSheet.flatten(screen.getByRole('button', { name }).props.style)?.backgroundColor ?? null
    const { palette } = appThemeOf(DEFAULT_THEME)
    expect(fillOf('Unlock')).toBe(palette.accent)
    expect(fillOf('Not now')).toBe(palette.quiet)
    expect(fillOf('Use another address')).toBe('transparent')
  })

  it('says so when the server cannot be added, and stays', async () => {
    getLock.mockResolvedValue({ available: false, unlocked: false })
    mockNewServerId.mockImplementation(() => 'not-a-uuid')
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(await screen.findByText(/couldn't be added/)).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it('says so when the device keeps as many servers as it can, and stays', async () => {
    getLock.mockResolvedValue({ available: false, unlocked: false })
    const full = Array.from({ length: SERVERS_CAP }, (_, n) => ({
      id: `7c9e6679-7425-40de-944b-${String(n).padStart(12, '0')}`,
      name: `nas${n}`,
      origin: `http://nas${n}:8080`,
      addedAt: n,
      account: null,
    }))
    useActiveServer.setState({ servers: full, activeId: null })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(await screen.findByText(/as many servers as it can/)).toBeTruthy()
    expect(useActiveServer.getState().servers).toHaveLength(SERVERS_CAP)
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it('shows an error rather than failing when no id can be made', async () => {
    mockNewServerId.mockImplementation(() => {
      throw new Error('no randomness')
    })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(await screen.findByText(/Couldn't reach a raven server/)).toBeTruthy()
  })

  it('unlocks with the PIN and goes Home on the new server', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    unlock.mockResolvedValue({ available: true, unlocked: true })
    await render(<SignIn />)

    await enterAddress('HTTP://nas:8080/')
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '1234')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(unlock).toHaveBeenCalledWith('1234')
    expect(getMediaTicket).toHaveBeenCalledWith(7)
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
    expect(useActiveServer.getState()).toMatchObject({
      servers: [{ id: MOCK_SERVER_ID, name: 'nas:8080', origin: 'http://nas:8080' }],
      activeId: MOCK_SERVER_ID,
    })
  })

  it('asks for no PIN when the server has none', async () => {
    getLock.mockResolvedValue({ available: false, unlocked: false })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(unlock).not.toHaveBeenCalled()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it("shows the spec's words when the server hands out no tickets, then goes Home", async () => {
    getLock.mockResolvedValue({ available: false, unlocked: false })
    getMediaTicket.mockRejectedValue(new ApiError({ status: 503, message: 'no secret' }))
    await render(<SignIn />)

    await enterAddress('http://nas:8080')
    expect(await screen.findByText(TICKETS_OFF)).toBeTruthy()
    expect(TICKETS_OFF).toBe(
      "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in the app",
    )
    expect(mockDismissTo).not.toHaveBeenCalled()
    expect(useActiveServer.getState().activeId).toBe(MOCK_SERVER_ID)

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('refuses an address that is not a bare origin, without calling it', async () => {
    await render(<SignIn />)
    await enterAddress('http://nas:8080/library')
    expect(await screen.findByText(/like http:\/\/192\.168\.1\.20:8484/)).toBeTruthy()
    expect(mockApiFor).not.toHaveBeenCalled()
  })

  it("says so when the address doesn't answer", async () => {
    getLock.mockRejectedValue(new TypeError('Network request failed'))
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(await screen.findByText(/Couldn't reach a raven server/)).toBeTruthy()
    expect(useActiveServer.getState().servers).toEqual([])
  })

  it("shows the server's words for a wrong PIN", async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    unlock.mockRejectedValue(new ApiError({ status: 401, message: 'That PIN is not right.' }))
    await render(<SignIn />)

    await enterAddress('http://nas:8080')
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '0000')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That PIN is not right.')).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it('signs in again to a server already on the list, under its own id', async () => {
    const known = {
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      name: 'nas',
      origin: 'http://nas:8080',
      addedAt: 1,
      account: null,
    }
    useActiveServer.setState({ servers: [known], activeId: null })
    getLock.mockResolvedValue({ available: true, unlocked: true })
    await render(<SignIn />)

    await enterAddress('http://nas:8080')
    expect(mockApiFor).toHaveBeenCalledWith(known)
    expect(useActiveServer.getState()).toMatchObject({ servers: [known], activeId: known.id })
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  describe('a server that signs in with accounts', () => {
    const KNOWN: AppServer = {
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      name: 'nas',
      origin: 'http://nas:8080',
      addedAt: 1,
      account: null,
    }

    /** The buttons of the alert last shown, by their words. */
    const alertButton = (text: string): AlertButton | undefined => {
      const buttons = jest.mocked(Alert.alert).mock.lastCall?.[2] ?? []
      return buttons.find((button) => button.text === text)
    }

    const press = async (text: string) => {
      const button = alertButton(text)
      expect(button).toBeDefined()
      await act(() => button?.onPress?.())
    }

    beforeEach(() => {
      jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    })

    it('reads the auth config before anything else', async () => {
      getLock.mockResolvedValue({ available: false, unlocked: false })
      await render(<SignIn />)
      await enterAddress('http://nas:8080')
      expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
      const [config] = getAuthConfig.mock.invocationCallOrder
      const [lock] = getLock.mock.invocationCallOrder
      expect(config).toBeLessThan(lock ?? 0)
    })

    const EMAIL = 'friend@maester.test'
    const PASSWORD = 'correct horse battery staple'

    const reachAccount = async () => {
      getAuthConfig.mockResolvedValue(readyConfigOf(PIN))
      await render(<SignIn />)
      await enterAddress('http://nas:8080')
      expect(await screen.findByText(SIGN_IN_COPY.accountPrompt)).toBeTruthy()
    }

    const signInAs = async ({ email, password }: { email: string; password: string }) => {
      await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.email), email)
      await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.password), password)
      await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.signIn }))
    }

    it('asks for the email and password, adding nothing and asking for no PIN', async () => {
      await reachAccount()
      expect(screen.getByLabelText(SIGN_IN_COPY.email)).toBeTruthy()
      expect(screen.getByLabelText(SIGN_IN_COPY.password)).toBeTruthy()
      expect(screen.getByText(SIGN_IN_COPY.signsInWith('project.supabase.co'))).toBeTruthy()
      expect(useActiveServer.getState()).toMatchObject({ servers: [], activeId: null })
      expect(useAccountAnswers.getState().answers).toEqual({
        [MOCK_SERVER_ID]: ACCOUNT_ANSWERS.ready,
      })
      expect(getLock).not.toHaveBeenCalled()
      expect(getAdminLock).not.toHaveBeenCalled()
      expect(unlockAdmin).not.toHaveBeenCalled()
    })

    it('signs in at the endpoints the server names again, then adds it with its pin and goes Home', async () => {
      await reachAccount()
      await signInAs({ email: ` ${EMAIL} `, password: PASSWORD })

      const server = {
        id: MOCK_SERVER_ID,
        name: 'nas:8080',
        origin: 'http://nas:8080',
        addedAt: expect.any(Number),
        account: PIN,
      }
      expect(getAuthConfig).toHaveBeenCalledTimes(2)
      expect(mockSignIn).toHaveBeenCalledWith({
        server,
        account: PIN,
        email: EMAIL,
        password: PASSWORD,
      })
      expect(useActiveServer.getState()).toMatchObject({
        servers: [server],
        activeId: MOCK_SERVER_ID,
      })
      expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
      expect(getLock).not.toHaveBeenCalled()
      expect(getAdminLock).not.toHaveBeenCalled()
      expect(unlockAdmin).not.toHaveBeenCalled()
    })

    it("says the sign-in's words for a wrong password, adds nothing and clears the password", async () => {
      mockSignIn.mockResolvedValue(SIGN_IN_OUTCOMES.wrongPassword)
      await reachAccount()
      await signInAs({ email: EMAIL, password: 'wrong' })
      expect(await screen.findByText(SIGN_IN_MESSAGES.wrongPassword)).toBeTruthy()
      expect(screen.getByLabelText(SIGN_IN_COPY.password).props.value).toBe('')
      expect(useActiveServer.getState().servers).toEqual([])
      expect(mockDismissTo).not.toHaveBeenCalled()
    })

    it('sends no password once the server names other endpoints, and asks first', async () => {
      await reachAccount()
      getAuthConfig.mockResolvedValue(readyConfigOf(MOVED_PIN))
      await signInAs({ email: EMAIL, password: PASSWORD })
      expect(mockSignIn).not.toHaveBeenCalled()
      expect(Alert.alert).toHaveBeenCalledWith(
        SIGN_IN_COPY.moved({ name: 'nas:8080', host: 'moved.supabase.co' }),
        SIGN_IN_COPY.movedDetail,
        expect.any(Array),
        expect.any(Object),
      )
    })

    it('forgets a session it could not add the server for', async () => {
      useActiveServer.setState({
        servers: Array.from({ length: SERVERS_CAP }, (_, index) => ({
          id: `0f8fad5b-d9cb-469f-a165-7086772895${String(index).padStart(2, '0')}`,
          name: `nas${index}`,
          origin: `http://nas${index}:8080`,
          addedAt: index,
          account: null,
        })),
        activeId: null,
      })
      await reachAccount()
      await signInAs({ email: EMAIL, password: PASSWORD })
      expect(await screen.findByText(SIGN_IN_COPY.full)).toBeTruthy()
      expect(mockForgetSession).toHaveBeenCalledWith({ serverId: MOCK_SERVER_ID })
    })

    it.each([
      [SIGN_IN_COPY.createAccount, AUTH_ROUTES.signUp],
      [SIGN_IN_COPY.forgotPassword, AUTH_ROUTES.forgot],
    ])("opens %s on the server's web origin in the browser", async (label, route) => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
      await reachAccount()
      await fireEvent.press(screen.getByRole('button', { name: label }))
      expect(openURL).toHaveBeenCalledWith(`${PIN.webUrl}${route}`)
    })

    it('says so when the browser will not open', async () => {
      jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'))
      await reachAccount()
      await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.createAccount }))
      expect(await screen.findByText(SIGN_IN_COPY.noBrowser)).toBeTruthy()
    })

    it('goes back to the address on Use another address', async () => {
      await reachAccount()
      await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.otherAddress }))
      expect(screen.getByLabelText('Server address')).toBeTruthy()
      expect(screen.queryByLabelText(SIGN_IN_COPY.password)).toBeNull()
    })

    it('opens on the account step of the active server once its account has signed out', async () => {
      useActiveServer.setState({ servers: [{ ...KNOWN, account: PIN }], activeId: KNOWN.id })
      useAccountState.setState({ signedIn: { [KNOWN.id]: false }, version: 1 })
      getAuthConfig.mockResolvedValue(readyConfigOf(PIN))
      await render(<SignIn />)
      expect(screen.getByText(SIGN_IN_COPY.accountPrompt)).toBeTruthy()
      await signInAs({ email: EMAIL, password: PASSWORD })
      const pinned = { ...KNOWN, account: PIN }
      expect(mockSignIn).toHaveBeenCalledWith({
        server: pinned,
        account: PIN,
        email: EMAIL,
        password: PASSWORD,
      })
      expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
    })

    it('goes straight on to a listed server whose account is signed in', async () => {
      useActiveServer.setState({ servers: [{ ...KNOWN, account: PIN }], activeId: null })
      useAccountState.setState({ signedIn: { [KNOWN.id]: true }, version: 1 })
      getAuthConfig.mockResolvedValue(readyConfigOf(PIN))
      await render(<SignIn />)
      await enterAddress('http://nas:8080')
      expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
      expect(useActiveServer.getState().activeId).toBe(KNOWN.id)
      expect(mockSignIn).not.toHaveBeenCalled()
    })

    it("pins a listed server's three endpoints the first time it is ready", async () => {
      useActiveServer.setState({ servers: [KNOWN], activeId: KNOWN.id })
      getAuthConfig.mockResolvedValue(readyConfigOf(PIN))
      await render(<SignIn />)
      await enterAddress('http://nas:8080')
      expect(await screen.findByText(SIGN_IN_COPY.accountPrompt)).toBeTruthy()
      expect(useActiveServer.getState().servers).toEqual([{ ...KNOWN, account: PIN }])
      expect(Alert.alert).not.toHaveBeenCalled()
    })

    it('asks before following a pinned server to other endpoints, and keeps the old pin on Cancel', async () => {
      useActiveServer.setState({ servers: [{ ...KNOWN, account: PIN }], activeId: null })
      getAuthConfig.mockResolvedValue(readyConfigOf(MOVED_PIN))
      await render(<SignIn />)
      await enterAddress('http://nas:8080')

      expect(Alert.alert).toHaveBeenCalledWith(
        SIGN_IN_COPY.moved({ name: 'nas', host: 'moved.supabase.co' }),
        SIGN_IN_COPY.movedDetail,
        expect.any(Array),
        expect.any(Object),
      )
      await press(SIGN_IN_COPY.cancel)

      expect(
        await screen.findByText(SIGN_IN_COPY.kept({ name: 'nas', host: 'project.supabase.co' })),
      ).toBeTruthy()
      expect(useActiveServer.getState().servers).toEqual([{ ...KNOWN, account: PIN }])
      expect(getLock).not.toHaveBeenCalled()
    })

    it('pins the new endpoints only on a yes, dropping the session kept for the old ones', async () => {
      useActiveServer.setState({ servers: [{ ...KNOWN, account: PIN }], activeId: KNOWN.id })
      useAccountState.setState({ signedIn: { [KNOWN.id]: true }, version: 1 })
      getAuthConfig.mockResolvedValue(readyConfigOf(MOVED_PIN))
      mockForgetSession.mockImplementation(async ({ serverId }) => {
        useAccountState.setState({ signedIn: { [serverId]: false }, version: 2 })
      })
      await render(<SignIn />)
      await enterAddress('http://nas:8080')
      expect(useActiveServer.getState().servers).toEqual([{ ...KNOWN, account: PIN }])
      expect(mockForgetSession).not.toHaveBeenCalled()

      await press(SIGN_IN_COPY.follow)

      expect(await screen.findByText(SIGN_IN_COPY.accountPrompt)).toBeTruthy()
      expect(mockForgetSession).toHaveBeenCalledWith({ serverId: KNOWN.id })
      expect(useActiveServer.getState().servers).toEqual([{ ...KNOWN, account: MOVED_PIN }])
      expect(screen.getByText(SIGN_IN_COPY.signsInWith('moved.supabase.co'))).toBeTruthy()
    })

    it('keeps the session on a no', async () => {
      useActiveServer.setState({ servers: [{ ...KNOWN, account: PIN }], activeId: null })
      getAuthConfig.mockResolvedValue(readyConfigOf(MOVED_PIN))
      await render(<SignIn />)
      await enterAddress('http://nas:8080')
      await press(SIGN_IN_COPY.cancel)
      expect(mockForgetSession).not.toHaveBeenCalled()
    })

    it("says so when the server's sign-in names endpoints the app cannot use", async () => {
      getAuthConfig.mockResolvedValue(
        readyConfigOf({ ...PIN, supabaseUrl: 'http://project.supabase.co' }),
      )
      await render(<SignIn />)
      await enterAddress('http://nas:8080')
      expect(await screen.findByText(SIGN_IN_COPY.badSignIn)).toBeTruthy()
      expect(getLock).not.toHaveBeenCalled()
    })

    it.each([
      ['off', async () => ({ state: AUTH_CONFIG_STATES.off })],
      ['unavailable', async () => ({ state: AUTH_CONFIG_STATES.unavailable })],
      [
        'not there, on a server older than accounts',
        async () => {
          throw new ApiError({ status: 404, message: 'Not Found' })
        },
      ],
    ] as const)('goes on to the PIN when its accounts are %s', async (_name, answer) => {
      getAuthConfig.mockImplementation(answer)
      getLock.mockResolvedValue({ available: true, unlocked: false })
      await render(<SignIn />)
      await enterAddress('http://nas:8080')
      expect(await screen.findByLabelText('PIN')).toBeTruthy()
    })

    it('asks for the admin password of a pinned server whose accounts are now off', async () => {
      useActiveServer.setState({ servers: [{ ...KNOWN, account: PIN }], activeId: null })
      getAuthConfig.mockResolvedValue({ state: AUTH_CONFIG_STATES.off })
      getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.on, available: true })
      await unlockWithPin()
      expect(await screen.findByLabelText('Admin password')).toBeTruthy()
      expect(useAccountAnswers.getState().answers).toEqual({ [KNOWN.id]: ACCOUNT_ANSWERS.off })
      expect(useActiveServer.getState().servers).toEqual([{ ...KNOWN, account: PIN }])
    })
  })
})
