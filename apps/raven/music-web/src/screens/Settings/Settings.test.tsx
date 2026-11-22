import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { type Account, MEMBER_STATUSES } from '@raven/core'
import { APPEARANCES, KIT_COPY, SETTINGS_COPY, STATUS_COPY } from '@raven/wren'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { version } from '#package'
import { api } from '@/lib/api'
import type { AuthClient } from '@/lib/authClient'
import { WREN_ROUTES } from '@/routes'
import { Settings } from '@/screens/Settings/Settings'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { SIGNED_IN, fakeAuthClient } from '@/test/authClient'
import { mockMusicApiEach } from '@/test/music'
import { renderWithProviders, signedIn } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

const LISTENER: Account = {
  id: SIGNED_IN.userId,
  email: 'listener@example.com',
  status: MEMBER_STATUSES.approved,
  isOwner: false,
}

type Mocks = { getMe: ReturnType<typeof spyOn<typeof api, 'getMe'>> | null }

const mocks: Mocks = { getMe: null }

const music = mockMusicApiEach()

type RenderSettingsProps = {
  formFactor?: FormFactor
  /** What Supabase answers a sign-out with. */
  signOut?: AuthClient['signOut']
}

/** Settings on a server with accounts on, the listener signed in. */
const renderSignedIn = ({
  formFactor,
  signOut = async () => ({ error: null }),
}: RenderSettingsProps = {}) => {
  const calls = mock(signOut)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  signedIn({ client, auth: fakeAuthClient({ calls: { signOut: calls } }).client })
  renderWithProviders({
    ui: <Settings />,
    route: WREN_ROUTES.settings,
    formFactor,
    authConfig: null,
    client,
  })
  return { calls }
}

/** Settings on a server with accounts off, as the fixture server runs: nobody signed in. */
const renderOpen = () => renderWithProviders({ ui: <Settings />, route: WREN_ROUTES.settings })

describe('Settings', () => {
  beforeEach(() => {
    mocks.getMe = spyOn(api, 'getMe').mockResolvedValue(LISTENER)
  })

  afterEach(() => {
    cleanup()
    mocks.getMe?.mockRestore()
  })

  it('says who is signed in, to which server, whether it answers, and which Wren this is', async () => {
    renderSignedIn()
    expect(screen.getByRole('heading', { name: SETTINGS_COPY.title })).toBeInTheDocument()
    expect(await screen.findByText(LISTENER.email)).toBeInTheDocument()
    expect(screen.getByText(STATUS_COPY.raven)).toBeInTheDocument()
    expect(await screen.findByText(STATUS_COPY.connected(STATUS_COPY.raven))).toBeInTheDocument()
    expect(screen.getByText(SETTINGS_COPY.version)).toBeInTheDocument()
    expect(screen.getByText(version)).toBeInTheDocument()
  })

  it("says when the server can't be reached", async () => {
    music().listLibraries.mockRejectedValue(new Error("raven can't be reached."))
    renderSignedIn()
    expect(await screen.findByText(STATUS_COPY.unreachable(STATUS_COPY.raven))).toBeInTheDocument()
  })

  it('keeps the appearance picked', async () => {
    renderOpen()
    const group = screen.getByRole('radiogroup', { name: SETTINGS_COPY.appearance })
    expect(within(group).getByRole('radio', { name: SETTINGS_COPY.system })).toBeChecked()

    await userEvent.click(within(group).getByRole('radio', { name: SETTINGS_COPY.dark }))
    expect(useWrenPrefs.getState().appearance).toBe(APPEARANCES.dark)
    expect(within(group).getByRole('radio', { name: SETTINGS_COPY.dark })).toBeChecked()
  })

  it("shows the fonts' licences", async () => {
    renderOpen()
    await userEvent.click(screen.getByRole('button', { name: SETTINGS_COPY.licenses }))

    const sheet = screen.getByRole('dialog', { name: SETTINGS_COPY.licenses })
    expect(within(sheet).getByText(SETTINGS_COPY.fontLicense)).toBeInTheDocument()
    expect(
      SETTINGS_COPY.fonts.map(({ name }) => within(sheet).getByRole('heading', { name })),
    ).toHaveLength(SETTINGS_COPY.fonts.length)

    const [, close] = within(sheet).getAllByRole('button', { name: KIT_COPY.close })
    await userEvent.click(close!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('has nothing of the downloads, the cellular stream or the address', () => {
    renderSignedIn()
    expect(screen.queryByRole('heading', { name: SETTINGS_COPY.downloads })).toBeNull()
    expect(screen.queryByText(SETTINGS_COPY.cellularQuality)).toBeNull()
    expect(screen.queryByRole('button', { name: SETTINGS_COPY.removeAll })).toBeNull()
    expect(screen.queryByText(window.location.origin)).toBeNull()
  })

  it.each([FORM_FACTORS.phone, FORM_FACTORS.tablet])(
    'shows every group on the %s layout',
    async (formFactor) => {
      renderSignedIn({ formFactor })
      expect(await screen.findByText(LISTENER.email)).toBeInTheDocument()
      expect(
        [SETTINGS_COPY.server, SETTINGS_COPY.appearance, SETTINGS_COPY.about].map((name) =>
          screen.getByRole('heading', { name }),
        ),
      ).toHaveLength(3)
    },
  )

  it('signs out, ending the session', async () => {
    const { calls } = renderSignedIn()
    await userEvent.click(screen.getByRole('button', { name: SETTINGS_COPY.signOut }))
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1))
  })

  it('has no account and no Sign out on a server with accounts off', async () => {
    renderOpen()
    expect(await screen.findByText(STATUS_COPY.connected(STATUS_COPY.raven))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SETTINGS_COPY.signOut })).toBeNull()
    expect(mocks.getMe).not.toHaveBeenCalled()
  })
})
