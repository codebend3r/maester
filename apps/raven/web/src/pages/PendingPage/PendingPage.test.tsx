import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type Account,
  ApiError,
  AUTH_CONFIG_STATES,
  AUTH_REFUSALS,
  MEMBER_STATUSES,
  AUTH_ROUTES,
} from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { type AuthClient } from '@/lib/authClient'
import { HOME_PATH, signInPath } from '@/lib/authRoutes'
import { queryKeys } from '@raven/ui/headless'
import { PendingPage } from '@/pages/PendingPage/PendingPage'
import { useAuthSession } from '@/stores/authSession'
import { ACCOUNT_ID, fakeAccount, readyConfig } from '@/test/authClient'
import { type AuthPageOptions, renderAuthPage, where } from '@/test/authPage'
import { held } from '@/test/held'

type SignOutResult = Awaited<ReturnType<AuthClient['signOut']>>

const WAITING = { name: 'Waiting for approval' } as const
const REMOVED = { name: 'Your access was removed' } as const
const CHECK_FAILED = 'Could not check. Try again.'

const refusal = ({ status, reason }: { status: number; reason: ApiError['refusal'] }) =>
  new ApiError({ status, message: 'Refused', refusal: reason })

const refused = ({ reason }: { reason: (typeof AUTH_REFUSALS)[keyof typeof AUTH_REFUSALS] }) =>
  refusal({ status: 403, reason: { reason, message: 'Refused' } })

const renderPending = ({
  signOut = async (): Promise<SignOutResult> => ({ error: null }),
  ...options
}: AuthPageOptions & { signOut?: AuthClient['signOut'] } = {}) =>
  renderAuthPage({
    path: AUTH_ROUTES.pending,
    page: <PendingPage />,
    isSignedIn: true,
    calls: { signOut },
    ...options,
  })

describe('PendingPage', () => {
  const getMe = spyOn(api, 'getMe')
  const getAuthConfig = spyOn(api, 'getAuthConfig')

  const answers = (...accounts: Account[]) =>
    accounts.forEach((account) => getMe.mockResolvedValueOnce(account))

  beforeEach(() => {
    getAuthConfig.mockResolvedValue(readyConfig)
  })

  afterEach(() => {
    getMe.mockReset()
    getAuthConfig.mockReset()
  })

  describe('an account waiting for approval', () => {
    it('says so, names the account and offers to check again or sign out', async () => {
      answers(fakeAccount({ status: MEMBER_STATUSES.pending, email: 'jordan@example.com' }))
      renderPending()

      expect(await screen.findByRole('heading', { level: 1, ...WAITING })).toBeVisible()
      expect(screen.getByText(/approves each new account by hand/)).toBeVisible()
      expect(screen.getByText('jordan@example.com')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
      expect(where()).toBe(AUTH_ROUTES.pending)
    })

    it('says so when the server refuses with pending, without an address to show', async () => {
      getMe.mockRejectedValue(refused({ reason: AUTH_REFUSALS.pending }))
      renderPending()

      expect(await screen.findByRole('heading', { level: 1, ...WAITING })).toBeVisible()
      expect(screen.queryByText(/Signed in as/)).toBeNull()
    })
  })

  describe('an account whose access was removed', () => {
    it('says so and offers the same two buttons', async () => {
      answers(fakeAccount({ status: MEMBER_STATUSES.revoked }))
      renderPending()

      expect(await screen.findByRole('heading', { level: 1, ...REMOVED })).toBeVisible()
      expect(screen.getByText(/removed this account's access/)).toBeVisible()
      expect(screen.getByText('viewer@example.com')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
    })

    it('says so when the server refuses with revoked', async () => {
      getMe.mockRejectedValue(refused({ reason: AUTH_REFUSALS.revoked }))
      renderPending()

      expect(await screen.findByRole('heading', { level: 1, ...REMOVED })).toBeVisible()
    })
  })

  describe('Check again', () => {
    it('goes home once the account is approved', async () => {
      const user = userEvent.setup()
      answers(
        fakeAccount({ status: MEMBER_STATUSES.pending }),
        fakeAccount({ status: MEMBER_STATUSES.approved }),
      )
      renderPending()

      await user.click(await screen.findByRole('button', { name: 'Check again' }))

      await waitFor(() => expect(where()).toBe(HOME_PATH))
      expect(getMe).toHaveBeenCalledTimes(2)
    })

    it('goes home once a refused account is approved', async () => {
      const user = userEvent.setup()
      getMe.mockRejectedValueOnce(refused({ reason: AUTH_REFUSALS.pending }))
      getMe.mockResolvedValueOnce(fakeAccount())
      renderPending()

      await user.click(await screen.findByRole('button', { name: 'Check again' }))

      await waitFor(() => expect(where()).toBe(HOME_PATH))
    })

    it('stays, and does not complain, while the account is still pending', async () => {
      const user = userEvent.setup()
      getMe.mockResolvedValue(fakeAccount({ status: MEMBER_STATUSES.pending }))
      renderPending()

      await user.click(await screen.findByRole('button', { name: 'Check again' }))

      await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled())
      expect(screen.getByRole('heading', { level: 1, ...WAITING })).toBeVisible()
      expect(screen.queryByText(CHECK_FAILED)).toBeNull()
      expect(where()).toBe(AUTH_ROUTES.pending)
    })

    it('stays when the server refuses with pending again', async () => {
      const user = userEvent.setup()
      getMe.mockRejectedValue(refused({ reason: AUTH_REFUSALS.pending }))
      renderPending()

      await user.click(await screen.findByRole('button', { name: 'Check again' }))

      await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2))
      expect(screen.getByRole('heading', { level: 1, ...WAITING })).toBeVisible()
      expect(screen.queryByText(CHECK_FAILED)).toBeNull()
    })

    it('updates the copy when the status became removed', async () => {
      const user = userEvent.setup()
      answers(
        fakeAccount({ status: MEMBER_STATUSES.pending }),
        fakeAccount({ status: MEMBER_STATUSES.revoked }),
      )
      renderPending()

      await user.click(await screen.findByRole('button', { name: 'Check again' }))

      expect(await screen.findByRole('heading', { level: 1, ...REMOVED })).toBeVisible()
      expect(screen.queryByRole('heading', WAITING)).toBeNull()
      expect(where()).toBe(AUTH_ROUTES.pending)
    })

    it('is busy while the answer is on its way', async () => {
      const user = userEvent.setup()
      const second = held<Account>()
      getMe.mockResolvedValueOnce(fakeAccount({ status: MEMBER_STATUSES.pending }))
      getMe.mockImplementationOnce(() => second.promise)
      renderPending()

      await user.click(await screen.findByRole('button', { name: 'Check again' }))

      expect(screen.getByRole('button', { name: 'Checking' })).toBeDisabled()

      await act(async () => second.answer(fakeAccount({ status: MEMBER_STATUSES.pending })))
      expect(await screen.findByRole('button', { name: 'Check again' })).toBeEnabled()
    })

    it.each([
      ['the server is unavailable', () => refused({ reason: AUTH_REFUSALS.unavailable })],
      ['the network fails', () => new TypeError('Failed to fetch')],
      [
        'the server fails',
        () => new ApiError({ status: 500, message: 'Internal Server Error', refusal: null }),
      ],
    ])('says it could not check, and keeps the session, when %s', async (_name, failure) => {
      const user = userEvent.setup()
      const signOut = mock(async (): Promise<SignOutResult> => ({ error: null }))
      getMe.mockResolvedValueOnce(fakeAccount({ status: MEMBER_STATUSES.pending }))
      getMe.mockRejectedValueOnce(failure())
      renderPending({ signOut })

      await user.click(await screen.findByRole('button', { name: 'Check again' }))

      expect(await screen.findByText(CHECK_FAILED)).toBeVisible()
      expect(screen.getByRole('heading', { level: 1, ...WAITING })).toBeVisible()
      expect(signOut).not.toHaveBeenCalled()
      expect(useAuthSession.getState().session?.userId).toBe(ACCOUNT_ID)
      expect(where()).toBe(AUTH_ROUTES.pending)
    })

    it('drops the message when the next check works', async () => {
      const user = userEvent.setup()
      getMe.mockResolvedValueOnce(fakeAccount({ status: MEMBER_STATUSES.pending }))
      getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      getMe.mockResolvedValueOnce(fakeAccount({ status: MEMBER_STATUSES.pending }))
      renderPending()

      await user.click(await screen.findByRole('button', { name: 'Check again' }))
      expect(await screen.findByText(CHECK_FAILED)).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'Check again' }))

      await waitFor(() => expect(screen.queryByText(CHECK_FAILED)).toBeNull())
    })
  })

  describe('Sign out', () => {
    it('ends the session, empties the cache and goes to sign in', async () => {
      const user = userEvent.setup()
      getMe.mockResolvedValue(fakeAccount({ status: MEMBER_STATUSES.pending }))
      const signOut = mock(async (): Promise<SignOutResult> => {
        useAuthSession.setState({ session: null })
        return { error: null }
      })
      const { client } = renderPending({ signOut })
      await screen.findByRole('heading', { level: 1, ...WAITING })

      await user.click(screen.getByRole('button', { name: 'Sign out' }))

      await waitFor(() => expect(where()).toBe(signInPath({ returnTo: HOME_PATH })))
      expect(signOut).toHaveBeenCalledTimes(1)
      expect(useAuthSession.getState().session).toBeNull()
      expect(client.getQueryData(queryKeys.account(ACCOUNT_ID))).toBeUndefined()
    })

    it('is busy while the session ends', async () => {
      const user = userEvent.setup()
      getMe.mockResolvedValue(fakeAccount({ status: MEMBER_STATUSES.pending }))
      const ending = held<SignOutResult>()
      renderPending({ signOut: () => ending.promise })

      await user.click(await screen.findByRole('button', { name: 'Sign out' }))

      expect(screen.getByRole('button', { name: 'Signing out' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled()

      await act(async () => ending.answer({ error: null }))
    })
  })

  describe('a visitor who does not belong here', () => {
    it('sends a signed out visitor to sign in, then home once signed in', async () => {
      renderPending({ isSignedIn: false })

      await waitFor(() => expect(where()).toBe(signInPath({ returnTo: HOME_PATH })))
      expect(getMe).not.toHaveBeenCalled()
    })

    it('sends a visitor whose session the server refuses to sign in', async () => {
      getMe.mockRejectedValue(refused({ reason: AUTH_REFUSALS.signedOut }))
      renderPending()

      await waitFor(() => expect(where()).toBe(signInPath({ returnTo: HOME_PATH })))
    })

    it('sends an approved account home', async () => {
      getMe.mockResolvedValue(fakeAccount())
      renderPending()

      await waitFor(() => expect(where()).toBe(HOME_PATH))
    })

    it('sends a visitor home while accounts are off', async () => {
      renderPending({ authConfig: { state: AUTH_CONFIG_STATES.off }, isSignedIn: false })

      await waitFor(() => expect(where()).toBe(HOME_PATH))
      expect(getMe).not.toHaveBeenCalled()
    })
  })

  describe('while the account is not known', () => {
    it('waits while the account is read, without the buttons', () => {
      getMe.mockImplementation(() => new Promise(() => undefined))
      renderPending()

      expect(screen.getByRole('status')).toHaveTextContent('Checking your account')
      expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    })

    it('shows a notice while accounts cannot be reached', () => {
      renderPending({ authConfig: { state: AUTH_CONFIG_STATES.unavailable } })

      expect(
        screen.getByRole('heading', { level: 1, name: 'Sign in is temporarily unavailable' }),
      ).toBeVisible()
      expect(where()).toBe(AUTH_ROUTES.pending)
    })

    it('shows the notice when the account cannot be read, and keeps the session', async () => {
      getMe.mockRejectedValue(refused({ reason: AUTH_REFUSALS.unavailable }))
      renderPending()

      expect(
        await screen.findByRole('heading', { name: 'Sign in is temporarily unavailable' }),
      ).toBeVisible()
      expect(useAuthSession.getState().session?.userId).toBe(ACCOUNT_ID)
    })
  })

  describe('in the app', () => {
    const renderApp = ({ route }: { route: string }) =>
      renderAuthPage({ path: '*', page: <AppRoutes />, route, isSignedIn: true })

    it.each([
      ['pending', MEMBER_STATUSES.pending, WAITING],
      ['revoked', MEMBER_STATUSES.revoked, REMOVED],
    ])(
      'takes a %s account from the library to this page and stays, with no shell or library data',
      async (_name, status, heading) => {
        getMe.mockResolvedValue(fakeAccount({ status }))
        const getHome = spyOn(api, 'getHome')
        renderApp({ route: '/libraries/3' })

        expect(await screen.findByRole('heading', { level: 1, ...heading })).toBeVisible()
        expect(where()).toBe(AUTH_ROUTES.pending)
        expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
        expect(getHome).not.toHaveBeenCalled()
        expect(screen.getByRole('main')).toContainElement(
          screen.getByRole('heading', { level: 1, ...heading }),
        )
        getHome.mockRestore()
      },
    )

    it('lets an approved account on to the library once approved', async () => {
      const user = userEvent.setup()
      getMe.mockResolvedValueOnce(fakeAccount({ status: MEMBER_STATUSES.pending }))
      getMe.mockResolvedValue(fakeAccount())
      const getHome = spyOn(api, 'getHome').mockReturnValue(new Promise(() => undefined))
      renderApp({ route: '/libraries/3' })

      await user.click(await screen.findByRole('button', { name: 'Check again' }))

      await waitFor(() => expect(where()).toBe(HOME_PATH))
      expect(screen.queryByRole('heading', WAITING)).toBeNull()
      getHome.mockRestore()
    })
  })
})
