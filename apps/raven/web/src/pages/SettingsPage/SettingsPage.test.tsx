import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackSettingsState } from '@raven/core'
import { api } from '@/lib/api'
import { SettingsPage } from '@/pages/SettingsPage/SettingsPage'
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

const iconOf = (element: HTMLElement) => element.querySelector('svg')?.dataset.icon

describe('SettingsPage', () => {
  const spies = {
    get: spyOn(api, 'getPlaybackSettings'),
    set: spyOn(api, 'setPlaybackSettings'),
  }

  afterEach(() => {
    spies.get.mockReset()
    spies.set.mockReset()
  })

  it('shows each playback setting with its choices and what the hardware comes to', async () => {
    spies.get.mockImplementation(async () => STATE)
    renderWithProviders(<SettingsPage />, { playback: null })
    expect(await screen.findByRole('radio', { name: /Remux and transcode/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^1080p/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^Auto/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Tone map HDR/ })).toBeChecked()
    expect(screen.getByText('Transcodes encode with VideoToolbox right now.')).toBeInTheDocument()
  })

  it('marks the section and each setting with an icon of its own', async () => {
    spies.get.mockImplementation(async () => STATE)
    renderWithProviders(<SettingsPage />, { playback: null })
    expect(iconOf(await screen.findByRole('heading', { name: 'Playback' }))).toBe('playback')
    const icons = screen.getAllByRole('group').map(iconOf)
    expect(icons).toEqual(['file-play', 'convert', 'resize', 'gauge', 'chip', 'sun'])
  })

  it('puts every setting back to its default on a second click', async () => {
    spies.get.mockImplementation(async () => CHANGED)
    spies.set.mockImplementation(async (change) => ({
      ...CHANGED,
      settings: { ...CHANGED.settings, ...change },
    }))
    renderWithProviders(<SettingsPage />, { playback: null })
    await userEvent.click(await screen.findByRole('button', { name: 'Reset to defaults' }))
    expect(spies.set).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    await waitFor(() => expect(spies.set).toHaveBeenCalledWith(DEFAULT_PLAYBACK_SETTINGS))
    expect(await screen.findByRole('radio', { name: /Remux and transcode/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Tone map HDR/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Every setting is back to its default.')
  })

  it('keeps the settings when the reset is cancelled', async () => {
    spies.get.mockImplementation(async () => CHANGED)
    renderWithProviders(<SettingsPage />, { playback: null })
    await userEvent.click(await screen.findByRole('button', { name: 'Reset to defaults' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(spies.set).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: /Remux only/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Reset all' })).toBeNull()
  })

  it('has nothing to reset while every setting is at its default', async () => {
    spies.get.mockImplementation(async () => STATE)
    renderWithProviders(<SettingsPage />, { playback: null })
    expect(await screen.findByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
  })

  it('saves a choice as soon as it is picked', async () => {
    spies.get.mockImplementation(async () => STATE)
    spies.set.mockImplementation(async (change) => ({
      ...STATE,
      settings: { ...STATE.settings, ...change },
    }))
    renderWithProviders(<SettingsPage />, { playback: null })
    await userEvent.click(await screen.findByRole('radio', { name: /Remux only/ }))
    await waitFor(() => expect(spies.set).toHaveBeenCalledWith({ transcoding: 'remuxOnly' }))
    expect(screen.getByRole('radio', { name: /Remux only/ })).toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: /Tone map HDR/ }))
    await waitFor(() => expect(spies.set).toHaveBeenCalledWith({ tonemap: false }))
  })
})
