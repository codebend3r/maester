import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { type Account, MEMBER_STATUSES } from '@raven/core'
import {
  COLOR_SCHEMES,
  KIT_COPY,
  SETTINGS_COPY,
  STATUS_COPY,
  THEME_MODES,
  WREN_THEMES,
} from '@raven/wren'
import { queryKeys } from '@raven/ui/headless'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { wrenVersion } from '@/lib/version'
import { accountDataFor } from '@/lib/accountData'
import { api } from '@/lib/api'
import type { AuthClient } from '@/lib/authClient'
import { WREN_ROUTES } from '@/routes'
import { Settings } from '@/screens/Settings/Settings'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { SIGNED_IN, fakeAuthClient, readyConfig } from '@/test/authClient'
import { MUSIC, mockMusicApiEach } from '@/test/music'
import { renderWithProviders, signedIn } from '@/test/render'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'

const LISTENER: Account = {
  id: SIGNED_IN.userId,
  email: 'listener@example.com',
  status: MEMBER_STATUSES.approved,
  isOwner: false,
}

const THEME_NAMES = SETTINGS_COPY.themeNames

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

const HOME_SERVER_ID = '3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d'

/** Settings signed in to a server the account has named Vhagar. */
const renderNamed = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  signedIn({ client, auth: fakeAuthClient().client })
  client.setQueryData(queryKeys.authConfig, { ...readyConfig, serverId: HOME_SERVER_ID })
  client.setQueryData(queryKeys.serverNames(SIGNED_IN.userId), [
    { serverId: HOME_SERVER_ID, name: 'Vhagar' },
  ])
  renderWithProviders({ ui: <Settings />, route: WREN_ROUTES.settings, authConfig: null, client })
  return { client }
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
    expect(screen.getByText(SETTINGS_COPY.versionOf(wrenVersion))).toBeInTheDocument()
  })

  it("says when the server can't be reached", async () => {
    music().listLibraries.mockRejectedValue(new Error("raven can't be reached."))
    renderSignedIn()
    expect(await screen.findByText(STATUS_COPY.unreachable(STATUS_COPY.raven))).toBeInTheDocument()
  })

  it("keeps a theme for each of the device's schemes, starting on the slot showing", async () => {
    renderOpen()
    const modes = screen.getByRole('radiogroup', { name: SETTINGS_COPY.themeMode })
    expect(
      within(modes).getByRole('radio', { name: SETTINGS_COPY.themeModes[THEME_MODES.system] }),
    ).toBeChecked()
    const slots = screen.getByRole('radiogroup', { name: SETTINGS_COPY.themeSlots })
    expect(within(slots).getByText(SETTINGS_COPY.showingNow)).toBeInTheDocument()

    // happy-dom's device is a light one, so the light slot is the one showing and picked.
    const light = screen.getByRole('radiogroup', {
      name: SETTINGS_COPY.themeFor[COLOR_SCHEMES.light],
    })
    expect(within(light).getByRole('radio', { name: THEME_NAMES.paper })).toBeChecked()
    await userEvent.click(within(light).getByRole('radio', { name: THEME_NAMES.banana }))
    expect(useWrenPrefs.getState().lightTheme).toBe(WREN_THEMES.banana)

    await userEvent.click(
      within(slots).getByRole('radio', {
        name: KIT_COPY.labelled({
          label: SETTINGS_COPY.themeSlotNames[COLOR_SCHEMES.dark],
          value: THEME_NAMES.night,
        }),
      }),
    )
    const dark = screen.getByRole('radiogroup', {
      name: SETTINGS_COPY.themeFor[COLOR_SCHEMES.dark],
    })
    expect(within(dark).getByRole('radio', { name: THEME_NAMES.night })).toBeChecked()
    await userEvent.click(within(dark).getByRole('radio', { name: THEME_NAMES.dracula }))
    expect(useWrenPrefs.getState()).toMatchObject({
      lightTheme: WREN_THEMES.banana,
      darkTheme: WREN_THEMES.dracula,
    })
  })

  it('keeps one theme whatever the device says, with no slots to pick', async () => {
    renderOpen()
    const modes = screen.getByRole('radiogroup', { name: SETTINGS_COPY.themeMode })
    await userEvent.click(
      within(modes).getByRole('radio', { name: SETTINGS_COPY.themeModes[THEME_MODES.single] }),
    )
    expect(screen.queryByRole('radiogroup', { name: SETTINGS_COPY.themeSlots })).toBeNull()

    const themes = screen.getByRole('radiogroup', { name: SETTINGS_COPY.theme })
    expect(within(themes).getAllByRole('radio')).toHaveLength(Object.keys(WREN_THEMES).length)
    await userEvent.click(within(themes).getByRole('radio', { name: THEME_NAMES.garnet }))
    expect(useWrenPrefs.getState()).toMatchObject({
      themeMode: THEME_MODES.single,
      theme: WREN_THEMES.garnet,
    })
    expect(within(themes).getByRole('radio', { name: THEME_NAMES.garnet })).toBeChecked()
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

  it("shows the server's address, port included, with only the name to edit", async () => {
    renderSignedIn()
    const server = screen.getByRole('heading', { name: SETTINGS_COPY.server }).closest('section')
    expect(within(server!).getByText(SETTINGS_COPY.serverAddress)).toBeInTheDocument()
    expect(within(server!).getByText(window.location.origin)).toBeInTheDocument()
    expect(screen.getByText(SETTINGS_COPY.serverNote)).toBeInTheDocument()
    expect(within(server!).queryByRole('button')).toBeNull()
    expect(within(server!).queryByRole('link')).toBeNull()
    expect(within(server!).getAllByRole('textbox')).toHaveLength(1)
  })

  it('switches the music library worn', async () => {
    const vinyl = { ...MUSIC, id: 6, name: 'Vinyl' }
    music().listLibraries.mockResolvedValue([MUSIC, vinyl])
    renderSignedIn()

    const libraries = await screen.findByRole('radiogroup', { name: SETTINGS_COPY.library })
    expect(within(libraries).getByRole('radio', { name: MUSIC.name })).toBeChecked()

    await userEvent.click(within(libraries).getByRole('radio', { name: vinyl.name }))
    expect(useWrenPrefs.getState().libraryId).toBe(vinyl.id)
    expect(within(libraries).getByRole('radio', { name: vinyl.name })).toBeChecked()
  })

  it("names the server on the account, and wears the account's name wherever it says what it is connected to", async () => {
    const { client } = renderNamed()
    const account = accountDataFor(readyConfig)
    let names = [{ serverId: HOME_SERVER_ID, name: 'Vhagar' }]
    const listed = spyOn(account, 'listServerNames').mockImplementation(async () => names)
    const named = spyOn(account, 'nameServer').mockImplementation(async ({ serverId, name }) => {
      names = [{ serverId, name }]
      return { serverId, name }
    })
    const field = await screen.findByRole('textbox', { name: SETTINGS_COPY.serverName })
    expect(field).toHaveValue('Vhagar')
    await userEvent.clear(field)
    await userEvent.type(field, '  Living   room {Enter}')
    expect(named).toHaveBeenCalledWith({ serverId: HOME_SERVER_ID, name: 'Living room' })
    expect(await screen.findByText(STATUS_COPY.connected('Living room'))).toBeInTheDocument()
    expect(client.getQueryData(queryKeys.serverNames(SIGNED_IN.userId))).toEqual(names)
    listed.mockRestore()
    named.mockRestore()
  })

  it('keeps the name when the field is left blank, and refuses one that is too long', async () => {
    renderNamed()
    const named = spyOn(accountDataFor(readyConfig), 'nameServer')
    const field = await screen.findByRole('textbox', { name: SETTINGS_COPY.serverName })
    await userEvent.clear(field)
    await userEvent.tab()
    expect(field).toHaveValue('Vhagar')
    await userEvent.click(field)
    await userEvent.paste('x'.repeat(80))
    expect(screen.getByText(SETTINGS_COPY.serverNameError)).toBeInTheDocument()
    await userEvent.type(field, '{Enter}')
    expect(named).not.toHaveBeenCalled()
    named.mockRestore()
  })

  it('has nothing of the downloads or the cellular stream', () => {
    renderSignedIn()
    expect(screen.queryByRole('heading', { name: SETTINGS_COPY.downloads })).toBeNull()
    expect(screen.queryByText(SETTINGS_COPY.cellularQuality)).toBeNull()
    expect(screen.queryByRole('button', { name: SETTINGS_COPY.removeAll })).toBeNull()
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
