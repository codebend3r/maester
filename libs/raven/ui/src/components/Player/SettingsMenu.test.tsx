import { describe, expect, it, jest } from 'bun:test'
import { PLAYBACK_MODES, type PlaybackMode } from '@raven/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { MENU_SECTIONS } from '@/components/Player/menus'
import { SettingsMenu } from '@/components/Player/SettingsMenu'
import type { ModeChoice } from '@/components/Player/usePlaybackLadder'
import type { TrackSelection } from '@/components/Player/useTrackSelection'

const selection: TrackSelection = {
  tracks: null,
  tracksFailed: false,
  tracksPending: false,
  audio: null,
  isDefaultAudio: true,
  subtitle: null,
  isWaitingForTracks: false,
  pickAudio: () => {},
  pickSubtitle: () => {},
}

const choiceOf = (overrides: Partial<ModeChoice>): ModeChoice => ({
  modes: [PLAYBACK_MODES.transcode],
  pick: () => {},
  qualities: [],
  quality: null,
  pickQuality: () => {},
  ...overrides,
})

const renderPlayback = ({
  choice,
  mode = PLAYBACK_MODES.transcode,
}: {
  choice: ModeChoice
  mode?: PlaybackMode
}) =>
  render(
    <SettingsMenu
      section={MENU_SECTIONS.playback}
      menuRef={createRef<HTMLDialogElement>()}
      selection={selection}
      subtitleStatus="off"
      rate={1}
      mode={mode}
      choice={choice}
      original="24.2 Mb/s, 4K"
      onPickRate={() => {}}
      onShowInfo={() => {}}
      onClose={() => {}}
    />,
  )

describe('SettingsMenu playback section', () => {
  it('lists the ways the file can play and picks one', async () => {
    const pick = jest.fn()
    renderPlayback({
      choice: choiceOf({ modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode], pick }),
    })
    const modes = within(screen.getByRole('group', { name: 'Play as' }))
    expect(modes.getByRole('radio', { name: /Video and audio converted/ })).toBeChecked()
    await userEvent.click(modes.getByRole('radio', { name: /Video untouched/ }))
    expect(pick).toHaveBeenCalledWith(PLAYBACK_MODES.remux)
  })

  it('only names the way when there is nothing to choose between', () => {
    renderPlayback({ choice: choiceOf({}) })
    expect(screen.queryByRole('group', { name: 'Play as' })).toBeNull()
    expect(screen.getByText('Video and audio converted on the server')).toBeInTheDocument()
  })

  it('lists the original, then each size to convert down to, Plex style', async () => {
    const pick = jest.fn()
    const pickQuality = jest.fn()
    renderPlayback({
      mode: PLAYBACK_MODES.remux,
      choice: choiceOf({
        modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
        pick,
        pickQuality,
        qualities: ['high1080', 'sd480'],
      }),
    })
    const sizes = within(screen.getByRole('group', { name: 'Quality' }))
    const original = sizes.getByRole('radio', { name: /Play original quality/ })
    expect(original).toBeChecked()
    expect(sizes.getByText('24.2 Mb/s, 4K')).toBeInTheDocument()
    expect(sizes.getByText('20.0 Mb/s')).toBeInTheDocument()
    await userEvent.click(sizes.getByRole('radio', { name: /Convert to 480p/ }))
    expect(pickQuality).toHaveBeenCalledWith('sd480')
    expect(pick).not.toHaveBeenCalled()
  })

  it('checks the size playing, and leaves the original out when only a conversion plays', () => {
    renderPlayback({
      choice: choiceOf({ qualities: ['high1080', 'sd480'], quality: 'sd480' }),
    })
    const sizes = within(screen.getByRole('group', { name: 'Quality' }))
    expect(sizes.queryByRole('radio', { name: /original/ })).toBeNull()
    expect(sizes.getByRole('radio', { name: /Convert to 480p/ })).toBeChecked()
    expect(sizes.getByRole('radio', { name: /Convert to 1080p HD \(High\)/ })).not.toBeChecked()
  })

  it('shows a transcode with no size picked as its own checked row, and keeps it out of Play as', () => {
    renderPlayback({
      choice: choiceOf({
        modes: [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
        qualities: ['sd480'],
      }),
    })
    const sizes = within(screen.getByRole('group', { name: 'Quality' }))
    expect(sizes.getByRole('radio', { name: /Converted at the server's size/ })).toBeChecked()
    expect(sizes.getByRole('radio', { name: /Play original quality/ })).not.toBeChecked()
    expect(sizes.getByRole('radio', { name: /Convert to 480p/ })).not.toBeChecked()
    const modes = within(screen.getByRole('group', { name: 'Play as' }))
    expect(modes.queryByRole('radio', { name: /Video and audio converted/ })).toBeNull()
    expect(modes.getByRole('radio', { name: /Playing the original file/ })).not.toBeChecked()
  })
})
