import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ApiError,
  AUTH_CONFIG_STATES,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  MEMBER_STATUSES,
  type Account,
  type PlaybackSettingsState,
} from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { SettingsPage } from '@/pages/SettingsPage/SettingsPage'
import { held } from '@/test/held'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { fakeAccount, readyConfig } from '@/test/authClient'
import { renderWithProviders } from '@/test/render'

const STATE: PlaybackSettingsState = {
  settings: DEFAULT_PLAYBACK_SETTINGS,
  effective: { encoder: 'videotoolbox', tonemapAvailable: true },
}

/** Three settings moved off their defaults. */
const CHANGED: PlaybackSettingsState = {
  ...STATE,
  settings: {
    ...DEFAULT_PLAYBACK_SETTINGS,
    transcoding: 'remuxOnly',
    quality: 'high',
    tonemap: false,
  },
}

const iconOf = (element: HTMLElement) => element.querySelector('svg')?.dataset.icon ?? null

describe('SettingsPage', () => {
  const spies = {
    get: spyOn(api, 'getPlaybackSettings'),
    set: spyOn(api, 'setPlaybackSettings'),
    getDisplay: spyOn(api, 'getDisplaySettings'),
    setDisplay: spyOn(api, 'setDisplaySettings'),
  }

  // Display settings start at their defaults and keep what the page saves.
  beforeEach(() => {
    const server = { display: DEFAULT_DISPLAY_SETTINGS }
    spies.getDisplay.mockImplementation(async () => server.display)
    spies.setDisplay.mockImplementation(async (change) => {
      server.display = { ...server.display, ...change }
      return server.display
    })
  })

  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  /** Serves playback settings that start as `start` and change as the page saves them. */
  const servePlayback = (start: PlaybackSettingsState) => {
    const server = { state: start }
    spies.get.mockImplementation(async () => server.state)
    spies.set.mockImplementation(async (change) => {
      server.state = { ...server.state, settings: { ...server.state.settings, ...change } }
      return server.state
    })
  }

  it('shows each playback setting with its choices and what the hardware comes to', async () => {
    spies.get.mockImplementation(async () => STATE)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    expect(await screen.findByRole('radio', { name: /Remux and transcode/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^1080p/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^Auto/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Tone map HDR/ })).toBeChecked()
    expect(screen.getByText('Transcodes encode with VideoToolbox right now.')).toBeInTheDocument()
  })

  it('marks the section and each setting with an icon of its own', async () => {
    spies.get.mockImplementation(async () => STATE)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    expect(iconOf(await screen.findByRole('heading', { name: 'Playback' }))).toBe('playback')
    expect(iconOf(await screen.findByRole('heading', { name: 'Display' }))).toBe('image')
    await screen.findByRole('group', { name: 'Movie titles' })
    const icons = screen.getAllByRole('group').map(iconOf)
    expect(icons).toEqual(['file-play', 'convert', 'resize', 'gauge', 'chip', 'sun', 'film'])
  })

  it('puts every setting back to its default on a second click', async () => {
    servePlayback(CHANGED)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    await userEvent.click(await screen.findByRole('button', { name: 'Reset to defaults' }))
    expect(spies.set).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    await waitFor(() => expect(spies.set).toHaveBeenCalledWith(DEFAULT_PLAYBACK_SETTINGS))
    expect(spies.setDisplay).toHaveBeenCalledWith(DEFAULT_DISPLAY_SETTINGS)
    expect(await screen.findByRole('radio', { name: /Remux and transcode/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Tone map HDR/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Every setting is back to its default.')
  })

  it('reads both again when a reset lands on one and fails on the other, and says so by Reset', async () => {
    servePlayback(CHANGED)
    spies.setDisplay.mockImplementation(async () => {
      throw new Error('The server did not answer')
    })
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    await userEvent.click(await screen.findByRole('button', { name: 'Reset to defaults' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reset: The server did not answer',
    )
    expect(within(screen.getByRole('region', { name: 'Playback' })).queryByRole('alert')).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Remux and transcode/ })).toBeChecked(),
    )
    expect(screen.getByRole('checkbox', { name: /Tone map HDR/ })).toBeChecked()
  })

  it('shows movie titles as logos, and spells them out once Text is chosen', async () => {
    spies.get.mockImplementation(async () => STATE)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    const titles = await screen.findByRole('group', { name: 'Movie titles' })
    expect(within(titles).getByRole('radio', { name: /^Logo/ })).toBeChecked()
    await userEvent.click(within(titles).getByRole('radio', { name: /^Text/ }))
    await waitFor(() => expect(spies.setDisplay).toHaveBeenCalledWith({ titles: 'text' }))
    expect(await within(titles).findByRole('radio', { name: /^Text/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled()
  })

  it('keeps the settings when the reset is cancelled', async () => {
    spies.get.mockImplementation(async () => CHANGED)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    await userEvent.click(await screen.findByRole('button', { name: 'Reset to defaults' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(spies.set).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: /Remux only/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Reset all' })).toBeNull()
  })

  it('has nothing to reset while every setting is at its default', async () => {
    spies.get.mockImplementation(async () => STATE)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    expect(await screen.findByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
  })

  it('saves a choice as soon as it is picked', async () => {
    servePlayback(STATE)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    await userEvent.click(await screen.findByRole('radio', { name: /Remux only/ }))
    await waitFor(() => expect(spies.set).toHaveBeenCalledWith({ transcoding: 'remuxOnly' }))
    expect(screen.getByRole('radio', { name: /Remux only/ })).toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: /Tone map HDR/ }))
    await waitFor(() => expect(spies.set).toHaveBeenCalledWith({ tonemap: false }))
  })

  it('shows a choice at once, every setting still open while it saves', async () => {
    spies.get.mockImplementation(async () => STATE)
    spies.set.mockImplementation(() => held<PlaybackSettingsState>().promise)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    await userEvent.click(await screen.findByRole('radio', { name: /Remux only/ }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /Remux only/ })).toBeChecked())
    expect(screen.getByRole('radio', { name: /^High/ })).toBeEnabled()
  })

  it('puts a choice back when it cannot be saved, and says why', async () => {
    spies.get.mockImplementation(async () => STATE)
    spies.set.mockImplementation(async () => {
      throw new Error('The server is away.')
    })
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    await userEvent.click(await screen.findByRole('radio', { name: /Remux only/ }))
    expect(await screen.findByText('Could not save: The server is away.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Remux and transcode/ })).toBeChecked()
  })

  it('shows the settings but keeps them as they are while the admin lock is on', async () => {
    servePlayback(CHANGED)
    renderWithProviders({
      ui: <SettingsPage />,
      playback: null,
      display: null,
      adminLock: { state: 'on', available: true },
    })
    await screen.findByRole('group', { name: 'Movie titles' })
    const controls = [
      ...screen.getAllByRole('radio'),
      screen.getByRole('checkbox', { name: /HDR/ }),
    ]
    expect(controls).toHaveLength(18)
    controls.forEach((control) => expect(control).toBeDisabled())
    expect(screen.getByRole('radio', { name: /Remux only/ })).toBeChecked()
    expect(screen.getAllByText('Turn the admin lock off below to change these.')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: /Remux and transcode/ }))
    expect(spies.set).not.toHaveBeenCalled()
  })

  it('stands in for the settings while they are read', async () => {
    spies.get.mockImplementation(() => held<PlaybackSettingsState>().promise)
    renderWithProviders({ ui: <SettingsPage />, playback: null, display: null })
    expect(screen.getAllByText('Reading the settings')).not.toEqual([])
  })
})

describe('the admin lock on SettingsPage', () => {
  const spies = {
    get: spyOn(api, 'getAdminLock'),
    unlock: spyOn(api, 'unlockAdmin'),
    lock: spyOn(api, 'lockAdmin'),
    keep: spyOn(api, 'keepAdminUnlocked'),
  }

  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  const toggle = () => screen.getByRole('checkbox', { name: /^Admin lock/ })

  it('ends the page, and turns off only with the password', async () => {
    const rightPassword = 'Soft-Wing-27'
    spies.unlock.mockImplementation(async (password) => {
      if (password !== rightPassword) {
        throw new ApiError({ status: 401, message: 'That password is not right.' })
      }
      return { state: 'off' }
    })
    renderWithProviders({ ui: <SettingsPage />, adminLock: { state: 'on', available: true } })
    expect(screen.getAllByRole('region').at(-1)).toHaveAccessibleName('Admin')
    expect(toggle()).toBeChecked()

    await userEvent.click(toggle())
    const password = screen.getByLabelText('Admin password')
    expect(password).toHaveFocus()
    await userEvent.type(password, 'soft-wing-27')
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not right.')
    expect(toggle()).not.toBeChecked()

    await userEvent.type(screen.getByLabelText('Admin password'), rightPassword)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(screen.queryByLabelText('Admin password')).toBeNull())
    expect(toggle()).not.toBeChecked()
    expect(spies.unlock.mock.calls).toEqual([['soft-wing-27'], [rightPassword]])
  })

  it('stays on when the password is not given after all', async () => {
    renderWithProviders({ ui: <SettingsPage />, adminLock: { state: 'on', available: true } })
    await userEvent.click(toggle())
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Admin password')).toBeNull()
    expect(toggle()).toBeChecked()
    expect(spies.unlock).not.toHaveBeenCalled()
  })

  it('turns on after a wait, in which it goes off again with no password', async () => {
    spies.lock.mockImplementation(async () => ({ state: 'turningOn', remainingMs: 15_000 }))
    spies.keep.mockImplementation(async () => ({ state: 'off' }))
    renderWithProviders({ ui: <SettingsPage />, adminLock: { state: 'off' } })
    expect(toggle()).not.toBeChecked()

    await userEvent.click(toggle())
    expect(await screen.findByText(/Turns on in 15 seconds/)).toBeInTheDocument()
    expect(toggle()).toBeChecked()

    await userEvent.click(toggle())
    await waitFor(() => expect(toggle()).not.toBeChecked())
    expect(spies.keep).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Admin password')).toBeNull()
  })

  it('cannot be turned off until the server has a password', async () => {
    renderWithProviders({ ui: <SettingsPage />, adminLock: { state: 'on', available: false } })
    expect(toggle()).toBeChecked()
    expect(toggle()).toBeDisabled()
    expect(screen.getByText(/to turn it off/)).toHaveTextContent(
      "Set ADMIN_PASSWORD in raven's .env to turn it off.",
    )
  })
})

describe('Open videos in raven player on SettingsPage', () => {
  const spies = { get: spyOn(api, 'getPlaybackSettings') }

  beforeEach(() => spies.get.mockImplementation(async () => STATE))
  afterEach(() => Object.values(spies).forEach((spy) => spy.mockReset()))

  const toggle = () => screen.getByRole('checkbox', { name: /^Open videos in raven player/ })

  it('sits in Playback, off until this browser turns it on', async () => {
    renderWithProviders({ ui: <SettingsPage />, playback: null })
    const playback = screen.getByRole('region', { name: 'Playback' })
    await within(playback).findByRole('radio', { name: /Remux only/ })
    expect(within(playback).getByRole('heading', { name: 'This browser' })).toBeInTheDocument()
    expect(toggle()).not.toBeChecked()
    expect(toggle().closest('label')).toHaveTextContent(
      "Offers raven player for videos this browser cannot play, in the player's settings, and Download to raven player on a title's page. Turn it on only where raven player is installed.",
    )
    await userEvent.click(toggle())
    expect(toggle()).toBeChecked()
    expect(usePlayerPrefs.getState().opensInRavenPlayer).toBe(true)
    await userEvent.click(toggle())
    expect(usePlayerPrefs.getState().opensInRavenPlayer).toBe(false)
  })

  it('stays open to change while the admin lock keeps the server settings', async () => {
    renderWithProviders({
      ui: <SettingsPage />,
      playback: null,
      adminLock: { state: 'on', available: true },
    })
    expect(await screen.findByRole('radio', { name: /Remux only/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Tone map HDR/ })).toBeDisabled()
    expect(toggle()).toBeEnabled()
    await userEvent.click(toggle())
    expect(usePlayerPrefs.getState().opensInRavenPlayer).toBe(true)
  })

  it('can be changed before the server settings are read, or when they cannot be', async () => {
    spies.get.mockImplementation(async () => {
      throw new Error('The server is away.')
    })
    renderWithProviders({ ui: <SettingsPage />, playback: null })
    expect(await screen.findByText('The server is away.')).toBeInTheDocument()
    await userEvent.click(toggle())
    expect(usePlayerPrefs.getState().opensInRavenPlayer).toBe(true)
  })
})

describe('Advanced on SettingsPage', () => {
  const spies = { get: spyOn(api, 'getPlaybackSettings') }

  beforeEach(() => spies.get.mockImplementation(async () => STATE))
  afterEach(() => Object.values(spies).forEach((spy) => spy.mockReset()))

  const slider = () => screen.getByRole('slider', { name: "Hide the player's controls after" })

  it("sets how long the player's controls linger, from three to ten seconds, five at first", () => {
    renderWithProviders({ ui: <SettingsPage />, playback: null })
    const advanced = screen.getByRole('region', { name: 'Advanced' })
    expect(within(advanced).getByRole('slider')).toBe(slider())
    expect(slider()).toHaveValue('5')
    expect(slider()).toHaveAttribute('min', '3')
    expect(slider()).toHaveAttribute('max', '10')
    expect(slider()).toHaveAttribute('aria-valuetext', '5 seconds')
    fireEvent.change(slider(), { target: { value: '8' } })
    expect(usePlayerPrefs.getState().controlsLingerSeconds).toBe(8)
    expect(within(advanced).getByText('8 seconds')).toBeInTheDocument()
  })

  it('sits before the admin lock and stays open while the lock is on', () => {
    renderWithProviders({
      ui: <SettingsPage />,
      playback: null,
      adminLock: { state: 'on', available: true },
    })
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Playback', 'Display', 'Advanced', 'Admin'])
    expect(slider()).toBeEnabled()
  })
})

describe('accounts on SettingsPage', () => {
  const spies = {
    playback: spyOn(api, 'getPlaybackSettings'),
    me: spyOn(api, 'getMe'),
    members: spyOn(api, 'listMembers'),
  }
  beforeEach(() => {
    spies.playback.mockImplementation(async () => STATE)
    spies.members.mockResolvedValue([])
  })
  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
    useAuthSession.setState({ client: null, session: null })
  })

  const headings = () =>
    screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)

  const renderSignedIn = (account: Account) => {
    useAuthSession.setState({
      status: AUTH_SESSION_STATUSES.ready,
      session: { accessToken: 't', userId: account.id },
    })
    spies.me.mockResolvedValue(account)
    renderWithProviders({ ui: <SettingsPage />, authConfig: readyConfig })
  }

  it('shows neither Account nor Users while accounts are off', () => {
    renderWithProviders({ ui: <SettingsPage /> })
    expect(headings()).toEqual(['Playback', 'Display', 'Advanced', 'Admin'])
    expect(spies.me).not.toHaveBeenCalled()
    expect(spies.members).not.toHaveBeenCalled()
  })

  it('shows neither while accounts cannot be reached', () => {
    renderWithProviders({
      ui: <SettingsPage />,
      authConfig: { state: AUTH_CONFIG_STATES.unavailable },
    })
    expect(headings()).toEqual(['Playback', 'Display', 'Advanced'])
    expect(spies.me).not.toHaveBeenCalled()
  })

  it('shows neither to an account that is not approved', async () => {
    renderSignedIn(fakeAccount({ status: MEMBER_STATUSES.pending, isOwner: true }))
    await waitFor(() => expect(spies.me).toHaveBeenCalled())
    expect(headings()).toEqual(['Playback', 'Display', 'Advanced'])
    expect(spies.members).not.toHaveBeenCalled()
  })

  it('shows Account but not Users to a member', async () => {
    renderSignedIn(fakeAccount())
    await screen.findByRole('heading', { name: 'Account' })
    expect(headings()).toEqual(['Playback', 'Display', 'Account', 'Advanced'])
    expect(spies.members).not.toHaveBeenCalled()
  })

  it('shows Account and Users, after Display, to the owner', async () => {
    renderSignedIn(fakeAccount({ isOwner: true }))
    await screen.findByRole('heading', { name: 'Users' })
    expect(headings()).toEqual(['Playback', 'Display', 'Account', 'Users', 'Advanced'])
  })

  describe('who may change the server settings', () => {
    const adminLock = spyOn(api, 'getAdminLock')
    const setPlayback = spyOn(api, 'setPlaybackSettings')

    afterEach(() => {
      adminLock.mockReset()
      setPlayback.mockReset()
    })

    it('lets the owner change them, with no admin lock section and no request for the lock', async () => {
      renderSignedIn(fakeAccount({ isOwner: true }))
      await screen.findByRole('heading', { name: 'Users' })
      const remuxOnly = await screen.findByRole('radio', { name: /Remux only/ })
      expect(remuxOnly).toBeEnabled()
      expect(screen.queryByText(/admin lock/i)).toBeNull()
      expect(screen.queryByRole('checkbox', { name: /^Admin lock/ })).toBeNull()
      expect(adminLock).not.toHaveBeenCalled()
    })

    it('holds them for a member, who is told only the owner can change them', async () => {
      renderSignedIn(fakeAccount())
      await screen.findByRole('heading', { name: 'Account' })
      const remuxOnly = await screen.findByRole('radio', { name: /Remux only/ })
      expect(remuxOnly).toBeDisabled()
      expect(screen.getAllByText('Only the owner can change these.')).toHaveLength(2)
      expect(screen.queryByText(/admin lock/i)).toBeNull()
      expect(adminLock).not.toHaveBeenCalled()
      expect(setPlayback).not.toHaveBeenCalled()
    })
  })
})
