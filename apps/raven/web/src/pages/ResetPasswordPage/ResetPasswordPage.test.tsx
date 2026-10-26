import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { AuthApiError } from '@supabase/supabase-js'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AUTH_CONFIG_STATES, ApiError, MEMBER_STATUSES, AUTH_ROUTES } from '@raven/core'
import { AppRoutes } from '@/AppRoutes'
import { api } from '@/lib/api'
import { type AuthClient } from '@/lib/authClient'
import { AUTH_ERRORS } from '@/lib/authErrors'
import { ResetPasswordPage } from '@/pages/ResetPasswordPage/ResetPasswordPage'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { fakeAccount, fakeSession } from '@/test/authClient'
import { type AuthPageOptions, renderAuthPage, where } from '@/test/authPage'
import { held } from '@/test/held'

type UpdateResult = Awaited<ReturnType<AuthClient['updateUser']>>

const updated = (): UpdateResult => ({ data: { user: fakeSession().user }, error: null })

type RefusedProps = { code: string; message: string }

const refused = ({ code, message }: RefusedProps): UpdateResult => ({
  data: { user: null },
  error: new AuthApiError(message, 422, code),
})

const renderReset = (options: AuthPageOptions = {}) =>
  renderAuthPage({
    path: AUTH_ROUTES.reset,
    page: <ResetPasswordPage />,
    isSignedIn: true,
    isRecovery: true,
    ...options,
  })

const password = () => screen.getByLabelText('New password')
const confirmation = () => screen.getByLabelText('Confirm password')
const submit = () => screen.getByRole('button', { name: /^(Update password|Updating password)/ })

type FillInProps = {
  user: ReturnType<typeof userEvent.setup>
  confirm?: string
}

const fillIn = async ({ user, confirm = 'correct-horse-battery' }: FillInProps) => {
  await user.type(password(), 'correct-horse-battery')
  await user.type(confirmation(), confirm)
}

describe('ResetPasswordPage', () => {
  const getMe = spyOn(api, 'getMe')

  beforeEach(() => {
    getMe.mockResolvedValue(fakeAccount())
  })

  afterEach(() => {
    getMe.mockReset()
  })

  describe('with a recovery session', () => {
    it('asks for a new password twice, even though the session is of an approved account', async () => {
      renderReset()

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Choose a new password' }),
      ).toBeInTheDocument()
      expect(password()).toHaveAttribute('type', 'password')
      expect(password()).toHaveAttribute('autocomplete', 'new-password')
      expect(confirmation()).toHaveAttribute('autocomplete', 'new-password')
      expect(where()).toBe(AUTH_ROUTES.reset)
    })

    it.each([
      ['pending', MEMBER_STATUSES.pending],
      ['revoked', MEMBER_STATUSES.revoked],
    ])('keeps an account that is %s on the page', async (_name, status) => {
      getMe.mockResolvedValue(fakeAccount({ status }))
      renderReset()

      expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeVisible()
      expect(where()).toBe(AUTH_ROUTES.reset)
    })

    it('does not update while the two passwords differ, and says so on the confirmation', async () => {
      const user = userEvent.setup()
      const updateUser = mock(async () => updated())
      renderReset({ calls: { updateUser } })
      await screen.findByLabelText('New password')
      await fillIn({ user, confirm: 'correct-horse-batterY' })

      await user.click(submit())

      expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
      expect(confirmation()).toHaveAttribute('aria-invalid', 'true')
      expect(confirmation()).toHaveAccessibleDescription('The passwords do not match.')
      expect(updateUser).not.toHaveBeenCalled()
      expect(where()).toBe(AUTH_ROUTES.reset)
    })

    it('updates the password, ends the recovery and goes home', async () => {
      const user = userEvent.setup()
      const attempt = held<UpdateResult>()
      const updateUser = mock(
        (_attributes: Parameters<AuthClient['updateUser']>[0]) => attempt.promise,
      )
      renderReset({ calls: { updateUser } })
      await screen.findByLabelText('New password')
      await fillIn({ user })

      await user.click(submit())

      expect(submit()).toHaveTextContent('Updating password…')
      expect(submit()).toBeDisabled()
      expect(updateUser).toHaveBeenCalledTimes(1)
      expect(updateUser.mock.calls[0]?.[0]).toEqual({ password: 'correct-horse-battery' })

      attempt.answer(updated())
      await waitFor(() => expect(where()).toBe('/'))
      expect(useAuthSession.getState().isRecovery).toBe(false)
    })

    it('shows the server’s words for a weak password, marking the password as the field to fix', async () => {
      const user = userEvent.setup()
      renderReset({
        calls: {
          updateUser: async () =>
            refused({
              code: AUTH_ERRORS.weakPassword,
              message: 'Password should be at least 12 characters.',
            }),
        },
      })
      await screen.findByLabelText('New password')
      await fillIn({ user })

      await user.click(submit())

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Password should be at least 12 characters.',
      )
      expect(password()).toHaveAttribute('aria-invalid', 'true')
      expect(password()).toHaveAccessibleDescription('Password should be at least 12 characters.')
      expect(submit()).toBeEnabled()
      expect(useAuthSession.getState().isRecovery).toBe(true)
    })

    it('drops a weak password refusal once the password changes, since it described the old one', async () => {
      const user = userEvent.setup()
      renderReset({
        calls: {
          updateUser: async () =>
            refused({
              code: AUTH_ERRORS.weakPassword,
              message: 'Password should be at least 12 characters.',
            }),
        },
      })
      await screen.findByLabelText('New password')
      await fillIn({ user })
      await user.click(submit())
      await screen.findByRole('alert')

      await user.type(password(), '-staple')

      expect(screen.queryByText('Password should be at least 12 characters.')).toBeNull()
      expect(password()).toHaveAttribute('aria-invalid', 'false')
    })

    it.each([
      ['an unknown error code', async () => refused({ code: 'something_new', message: 'Words' })],
      [
        'a request that never arrived',
        async (): Promise<UpdateResult> => {
          throw new TypeError('Failed to fetch')
        },
      ],
    ])('says it could not update for %s', async (_name, updateUser) => {
      const user = userEvent.setup()
      renderReset({ calls: { updateUser } })
      await screen.findByLabelText('New password')
      await fillIn({ user })

      await user.click(submit())

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not update your password. Try again.',
      )
      expect(screen.queryByText('Words')).toBeNull()
    })
  })

  describe('without a recovery session', () => {
    it('sends a visitor with no session to ask for a link', async () => {
      renderReset({ isSignedIn: false, isRecovery: false })

      await waitFor(() => expect(where()).toBe(AUTH_ROUTES.forgot))
      expect(screen.queryByLabelText('New password')).toBeNull()
    })

    it('sends an ordinary signed in visitor to ask for a link, with no way to set a password', async () => {
      const updateUser = mock(async () => updated())
      renderReset({ isRecovery: false, calls: { updateUser } })

      await waitFor(() => expect(where()).toBe(AUTH_ROUTES.forgot))
      expect(screen.queryByLabelText('New password')).toBeNull()
      expect(updateUser).not.toHaveBeenCalled()
    })
  })

  describe('what the server says about accounts', () => {
    it('shows a notice instead of the form while accounts cannot be reached', () => {
      renderReset({ authConfig: { state: AUTH_CONFIG_STATES.unavailable } })

      expect(
        screen.getByRole('heading', { level: 1, name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('New password')).toBeNull()
    })

    it('sends a visitor home while accounts are off', async () => {
      renderReset({ authConfig: { state: AUTH_CONFIG_STATES.off } })

      await waitFor(() => expect(where()).toBe('/'))
    })

    it('waits while the config or the stored session is read, without sending the visitor away', () => {
      renderReset({ status: AUTH_SESSION_STATUSES.booting, isRecovery: false })

      expect(screen.getByRole('status')).toHaveTextContent('Loading')
      expect(where()).toBe(AUTH_ROUTES.reset)
    })

    it('shows the notice when the account cannot be read', async () => {
      getMe.mockRejectedValue(new ApiError({ status: 503, message: 'Unavailable' }))
      renderReset()

      expect(
        await screen.findByRole('heading', { name: 'Sign in is temporarily unavailable' }),
      ).toBeInTheDocument()
    })
  })

  it('takes the whole screen at /reset-password, outside the browsing frame', async () => {
    renderAuthPage({
      path: '*',
      page: <AppRoutes />,
      route: AUTH_ROUTES.reset,
      isSignedIn: true,
      isRecovery: true,
    })

    expect(await screen.findByLabelText('New password')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
  })
})
