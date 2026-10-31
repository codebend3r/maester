import { describe, expect, it } from 'bun:test'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EQ_PRESET_NAMES, EQ_PRESETS, LEVELLING_MODES } from '@raven/core'
import { MUSIC_QUALITIES, usePlayerPrefs } from '@raven/ui/headless'
import type { AudioConnection, NativeAudio } from '@/desktop/audioConnection'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { SettingsPage } from '@/pages/SettingsPage/SettingsPage'
import { asPlayingDesktop, audioConnectionsOf } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

const BAND_NAMES = [
  '32 Hz',
  '64 Hz',
  '125 Hz',
  '250 Hz',
  '500 Hz',
  '1 kHz',
  '2 kHz',
  '4 kHz',
  '8 kHz',
  '16 kHz',
]

const LATER = "Crossfade plays in the browser and in Wren; Raven's player joins it later."

const prefs = () => usePlayerPrefs.getState()

const music = () => screen.getByRole('region', { name: 'Playback' })

/** A music engine that is there and takes every command. */
const nativeEngine: NativeAudio = { send: async () => {}, subscribe: () => () => undefined }

describe('music on SettingsPage', () => {
  it('picks the music quality and the volume levelling for this browser', async () => {
    renderWithProviders({ ui: <SettingsPage /> })
    const quality = within(music()).getByRole('group', { name: 'Music quality' })
    expect(within(quality).getByRole('radio', { name: /^Original/ })).toBeChecked()
    await userEvent.click(within(quality).getByRole('radio', { name: /^256 kbps/ }))
    expect(prefs().musicQuality).toBe(MUSIC_QUALITIES.standard)
    const levelling = screen.getByRole('group', { name: 'Volume levelling' })
    expect(within(levelling).getByRole('radio', { name: /^Album/ })).toBeChecked()
    await userEvent.click(within(levelling).getByRole('radio', { name: /^Off/ }))
    expect(prefs().levelling).toBe(LEVELLING_MODES.off)
  })

  it('crossfades by one of its steps, off at first', () => {
    renderWithProviders({ ui: <SettingsPage /> })
    const crossfade = screen.getByRole('slider', { name: 'Crossfade' })
    expect(crossfade).toHaveAttribute('aria-valuetext', 'Off')
    fireEvent.change(crossfade, { target: { value: '5' } })
    expect(prefs().crossfade).toBe(12)
    expect(crossfade).toHaveAttribute('aria-valuetext', '12 seconds')
  })

  it('labels the equalizer bands from 32 Hz to 16 kHz, flat at first', () => {
    renderWithProviders({ ui: <SettingsPage /> })
    const bands = screen.getByRole('list', { name: 'Equalizer bands' })
    expect(within(bands).getAllByRole('slider')).toHaveLength(10)
    BAND_NAMES.forEach((name) => {
      const slider = within(bands).getByRole('slider', { name })
      expect(slider).toHaveValue('0')
      expect(slider).toHaveAttribute('min', '-12')
      expect(slider).toHaveAttribute('max', '12')
    })
    expect(screen.getByRole('radio', { name: /^Flat/ })).toBeChecked()
  })

  it('sets a preset, and turns custom once a band is moved by hand', async () => {
    renderWithProviders({ ui: <SettingsPage /> })
    await userEvent.click(screen.getByRole('radio', { name: /^Bass boost/ }))
    expect(prefs().equalizer).toEqual({
      preset: EQ_PRESET_NAMES.bassBoost,
      gains: EQ_PRESETS.bassBoost,
    })
    expect(screen.getByRole('slider', { name: '32 Hz' })).toHaveAttribute('aria-valuetext', '+6 dB')
    fireEvent.change(screen.getByRole('slider', { name: '1 kHz' }), { target: { value: '-3' } })
    expect(prefs().equalizer).toEqual({ preset: null, gains: [6, 5, 4, 2, 0, -3, 0, 0, 0, 0] })
    expect(screen.getByRole('radio', { name: /^Bass boost/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /^Custom/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /^Flat/ }))
    expect(prefs().equalizer).toEqual({ preset: EQ_PRESET_NAMES.flat, gains: EQ_PRESETS.flat })
    await userEvent.click(screen.getByRole('radio', { name: /^Custom/ }))
    expect(prefs().equalizer).toEqual({ preset: null, gains: EQ_PRESETS.flat })
  })

  it("says Raven's own player does not crossfade yet while its music engine plays", () => {
    asPlayingDesktop({
      audio: audioConnectionsOf({ status: CONNECTION_STATUSES.native, player: nativeEngine }),
    })
    renderWithProviders({ ui: <SettingsPage /> })
    expect(screen.queryByRole('slider', { name: 'Crossfade' })).toBeNull()
    expect(screen.getByText(LATER)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '32 Hz' })).toBeInTheDocument()
  })

  it.each<[string, AudioConnection]>([
    ['is on its way', { status: CONNECTION_STATUSES.waiting }],
    ['is not there', { status: CONNECTION_STATUSES.unavailable, message: 'No engine.' }],
    ['was lost', { status: CONNECTION_STATUSES.lost, message: 'Gone.' }],
  ])('offers crossfade inside Raven while its music engine %s', (_when, connection) => {
    asPlayingDesktop({ audio: audioConnectionsOf(connection) })
    renderWithProviders({ ui: <SettingsPage /> })
    expect(screen.getByRole('slider', { name: 'Crossfade' })).toBeInTheDocument()
    expect(screen.queryByText(LATER)).toBeNull()
  })
})
