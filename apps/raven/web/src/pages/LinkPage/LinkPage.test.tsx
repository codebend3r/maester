import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, DEVICE_LINK_PATH } from '@raven/core'
import { accountDataFor } from '@/lib/accountData'
import { api, homeApi } from '@/lib/api'
import { HOME_PATH } from '@/lib/authRoutes'
import { LinkPage } from '@/pages/LinkPage/LinkPage'
import { fakeAccount, readyConfig } from '@/test/authClient'
import { type AuthPageOptions, renderAuthPage, where } from '@/test/authPage'

const SCANNED = `${DEVICE_LINK_PATH}?code=BCDF-GHJK`
const TV = 'Raven on Apple TV'

const renderLink = (options: AuthPageOptions = {}) =>
  renderAuthPage({
    path: DEVICE_LINK_PATH,
    page: <LinkPage />,
    route: SCANNED,
    isSignedIn: true,
    ...options,
  })

describe('LinkPage', () => {
  const getMe = spyOn(api, 'getMe')
  const getAuthConfig = spyOn(homeApi, 'getAuthConfig')
  const request = spyOn(accountDataFor(readyConfig), 'deviceSignInRequest')
  const approve = spyOn(accountDataFor(readyConfig), 'approveDeviceSignIn')

  beforeEach(() => {
    getAuthConfig.mockResolvedValue(readyConfig)
    getMe.mockResolvedValue(fakeAccount({ email: 'jordan@example.com' }))
    request.mockResolvedValue(TV)
    approve.mockResolvedValue(true)
  })

  afterEach(() => {
    getMe.mockReset()
    getAuthConfig.mockReset()
    request.mockReset()
    approve.mockReset()
  })

  it('names the TV, the account and the code before anything is approved', async () => {
    renderLink()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in on this TV?' }),
    ).toBeVisible()
    expect(screen.getByText(TV)).toBeVisible()
    expect(screen.getByText('jordan@example.com')).toBeVisible()
    expect(screen.getByText('BCDF-GHJK')).toBeVisible()
    expect(request).toHaveBeenCalledWith({ code: 'BCDFGHJK' })
    expect(approve).not.toHaveBeenCalled()
  })

  it('approves the code on one press and says the TV is signing in', async () => {
    renderLink()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(approve).toHaveBeenCalledWith({ code: 'BCDFGHJK' })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your TV is signing in' }),
    ).toBeVisible()
  })

  it('goes home without approving when it is not the viewer’s TV', async () => {
    renderLink()
    await userEvent.click(await screen.findByRole('button', { name: 'Not my TV' }))

    expect(where()).toBe(HOME_PATH)
    expect(approve).not.toHaveBeenCalled()
  })

  it('asks for the code when the address has none, and takes it typed in any case', async () => {
    renderLink({ route: DEVICE_LINK_PATH })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in on your TV' }),
    ).toBeVisible()
    expect(request).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Code'), 'bcdf ghjk')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in on this TV?' }),
    ).toBeVisible()
    expect(request).toHaveBeenCalledWith({ code: 'BCDFGHJK' })
  })

  it('says a code that is not waiting is not, and asks for another', async () => {
    request.mockResolvedValue(null)
    renderLink()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'That code is not waiting' }),
    ).toBeVisible()
    expect(screen.getByLabelText('Code')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('says so when the code ran out between the look and the press', async () => {
    approve.mockResolvedValue(false)
    renderLink()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'That code is not waiting' }),
    ).toBeVisible()
  })

  it('offers to try again when the account database does not answer', async () => {
    request.mockRejectedValueOnce(new ApiError({ status: 503, message: 'Down' }))
    renderLink()

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in on this TV?' }),
    ).toBeVisible()
  })
})
