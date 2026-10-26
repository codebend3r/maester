import { describe, expect, it, jest } from 'bun:test'
import { PLAYBACK_MODES, type PlaybackMode, type StreamQuality } from '@raven/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { MENU_SECTIONS } from '@/components/Player/menus'
import { SettingsMenu } from '@/components/Player/SettingsMenu'
import { type PlayChoices, PICK_KINDS, choiceGroups } from '@/components/Player/playChoices'
import type { Rendition } from '@/components/Player/rendition'
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

type ChoicesForProps = {
  modes?: readonly PlaybackMode[]
  rendition: Rendition
  qualities?: readonly StreamQuality[]
  select?: PlayChoices['select']
}

const choicesFor = ({
  modes = [PLAYBACK_MODES.transcode],
  rendition,
  qualities = [],
  select = () => {},
}: ChoicesForProps): PlayChoices => ({
  groups: choiceGroups({ modes, rendition, qualities, original: '24.2 Mb/s, 4K' }),
  select,
})

type RenderPlaybackProps = {
  choices: PlayChoices
  mode?: PlaybackMode
  onPickAutoplay?: (isOn: boolean) => void
}

const renderPlayback = ({
  choices,
  mode = PLAYBACK_MODES.transcode,
  onPickAutoplay = () => {},
}: RenderPlaybackProps) =>
  render(
    <SettingsMenu
      section={MENU_SECTIONS.playback}
      menuRef={createRef<HTMLDialogElement>()}
      selection={selection}
      subtitleStatus="off"
      rate={1}
      mode={mode}
      choices={choices}
      onPickRate={() => {}}
      autoplay
      onPickAutoplay={onPickAutoplay}
      onShowInfo={() => {}}
      onClose={() => {}}
    />,
  )

const converting = { mode: PLAYBACK_MODES.transcode, quality: null } as const satisfies Rendition
const remuxing = { mode: PLAYBACK_MODES.remux, quality: null } as const satisfies Rendition

describe('SettingsMenu playback section', () => {
  it('switches autoplay under the speed', async () => {
    const onPickAutoplay = jest.fn()
    renderPlayback({ choices: { groups: [], select: () => {} }, onPickAutoplay })
    const autoplay = screen.getByRole('group', { name: 'Autoplay' })
    expect(within(autoplay).getByRole('radio', { name: 'On' })).toBeChecked()
    await userEvent.click(within(autoplay).getByRole('radio', { name: 'Off' }))
    expect(onPickAutoplay).toHaveBeenCalledWith(false)
  })

  it('lists the ways the file can play and picks one', async () => {
    const select = jest.fn()
    renderPlayback({
      choices: choicesFor({
        modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
        rendition: converting,
        select,
      }),
    })
    const modes = within(screen.getByRole('group', { name: 'Play as' }))
    expect(modes.getByRole('radio', { name: /Video and audio converted/ })).toBeChecked()
    await userEvent.click(modes.getByRole('radio', { name: /Video untouched/ }))
    expect(select).toHaveBeenCalledWith({ kind: PICK_KINDS.mode, mode: PLAYBACK_MODES.remux })
  })

  it('only names the way when there is nothing to choose between', () => {
    renderPlayback({ choices: choicesFor({ rendition: converting }) })
    expect(screen.queryByRole('group', { name: 'Play as' })).toBeNull()
    expect(screen.getByText('Video and audio converted on the server')).toBeInTheDocument()
  })

  it('lists the original, then each size to convert down to, Plex style', async () => {
    const select = jest.fn()
    renderPlayback({
      mode: PLAYBACK_MODES.remux,
      choices: choicesFor({
        modes: [PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
        rendition: remuxing,
        qualities: ['high1080', 'sd480'],
        select,
      }),
    })
    const sizes = within(screen.getByRole('group', { name: 'Quality' }))
    const original = sizes.getByRole('radio', { name: /Play original quality/ })
    expect(original).toBeChecked()
    expect(sizes.getByText('24.2 Mb/s, 4K')).toBeInTheDocument()
    expect(sizes.getByText('20.0 Mb/s')).toBeInTheDocument()
    await userEvent.click(sizes.getByRole('radio', { name: /Convert to 480p/ }))
    expect(select).toHaveBeenCalledWith({ kind: PICK_KINDS.size, quality: 'sd480' })
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('checks the size playing, and leaves the original out when only a conversion plays', () => {
    renderPlayback({
      choices: choicesFor({
        rendition: { mode: PLAYBACK_MODES.transcode, quality: 'sd480' },
        qualities: ['high1080', 'sd480'],
      }),
    })
    const sizes = within(screen.getByRole('group', { name: 'Quality' }))
    expect(sizes.queryByRole('radio', { name: /original/ })).toBeNull()
    expect(sizes.getByRole('radio', { name: /Convert to 480p/ })).toBeChecked()
    expect(sizes.getByRole('radio', { name: /Convert to 1080p HD \(High\)/ })).not.toBeChecked()
  })

  it('shows a transcode with no size picked as its own checked row, and keeps it out of Play as', () => {
    renderPlayback({
      choices: choicesFor({
        modes: [PLAYBACK_MODES.direct, PLAYBACK_MODES.remux, PLAYBACK_MODES.transcode],
        rendition: converting,
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
