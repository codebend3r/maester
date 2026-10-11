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
