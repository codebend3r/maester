import { describe, expect, it, jest } from 'bun:test'
import {
  CAPTION_COLOURS,
  CAPTION_SIZES,
  type CaptionStyle,
  DEFAULT_CAPTION_STYLE,
  PICTURE_SUBTITLES,
  type PictureSubtitles,
  PLAYBACK_MODES,
  type PlaybackMode,
  type StreamQuality,
  SUBTITLE_SOURCES,
  type SubtitleTrack,
} from '@raven/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { MENU_SECTIONS } from '@/components/Player/menus'
import type { PlayerQueue, QueueEntry } from '@/components/Player/PlayerServices'
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
  shouldPlayPickedAudio: false,
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
  pictures: PICTURE_SUBTITLES.hidden,
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
      captionStyle={DEFAULT_CAPTION_STYLE}
      onPickCaption={() => {}}
      onShowInfo={() => {}}
      onClose={() => {}}
      queue={null}
      onPlayEntry={() => {}}
    />,
  )

const converting = {
  mode: PLAYBACK_MODES.transcode,
  quality: null,
  burn: null,
} as const satisfies Rendition
const remuxing = {
  mode: PLAYBACK_MODES.remux,
  quality: null,
  burn: null,
} as const satisfies Rendition

describe('SettingsMenu queue section', () => {
  const entries: PlayerQueue['entries'] = [
    {
      key: '0:1',
      to: '/watch/1',
      state: null,
      label: 'Low Tide',
      detail: 'Season 1, Episode 1',
      isCurrent: true,
    },
    {
      key: '1:2',
      to: '/watch/2',
      state: null,
      label: 'High Water',
      detail: 'Season 1, Episode 2',
      isCurrent: false,
    },
  ]

  type RenderQueueProps = {
    queue: PlayerQueue
    onPlayEntry?: (entry: QueueEntry) => void
    onPickAutoplay?: (isOn: boolean) => void
  }

  const renderQueue = ({
    queue,
    onPlayEntry = () => {},
    onPickAutoplay = () => {},
  }: RenderQueueProps) =>
    render(
      <SettingsMenu
        section={MENU_SECTIONS.queue}
        menuRef={createRef<HTMLDialogElement>()}
        selection={selection}
        subtitleStatus="off"
        rate={1}
        mode={PLAYBACK_MODES.direct}
        onPickRate={() => {}}
        autoplay
        onPickAutoplay={onPickAutoplay}
        captionStyle={DEFAULT_CAPTION_STYLE}
        onPickCaption={() => {}}
        onShowInfo={() => {}}
        onClose={() => {}}
        queue={queue}
        onPlayEntry={onPlayEntry}
      />,
    )

  it('lists the session in order, marks the one playing and plays a pick', async () => {
    const onPlayEntry = jest.fn()
    renderQueue({ queue: { entries, shuffle: null }, onPlayEntry })
    const rows = within(screen.getByRole('list', { name: 'Queue' })).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Low TideNow playing',
      'High WaterSeason 1, Episode 2',
    ])
    expect(rows[0]).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /High Water/ }))
    expect(onPlayEntry).toHaveBeenCalledWith(entries[1])
  })

  it('switches autoplay and shuffle, and offers no shuffle where the session has none', async () => {
    const onPickAutoplay = jest.fn()
    const set = jest.fn()
    const { unmount } = renderQueue({
      queue: { entries, shuffle: { isOn: false, set } },
      onPickAutoplay,
    })
    const shuffle = screen.getByRole('group', { name: 'Shuffle' })
    expect(within(shuffle).getByRole('radio', { name: 'Off' })).toBeChecked()
    await userEvent.click(within(shuffle).getByRole('radio', { name: 'On' }))
    expect(set).toHaveBeenCalledWith(true)
    const autoplay = screen.getByRole('group', { name: 'Autoplay' })
    await userEvent.click(within(autoplay).getByRole('radio', { name: 'Off' }))
    expect(onPickAutoplay).toHaveBeenCalledWith(false)
    unmount()
    renderQueue({ queue: { entries, shuffle: null } })
    expect(screen.queryByRole('group', { name: 'Shuffle' })).toBeNull()
  })
})

describe('SettingsMenu playback section', () => {
  it('switches autoplay under the speed', async () => {
    const onPickAutoplay = jest.fn()
    renderPlayback({
      choices: { groups: [], pictures: PICTURE_SUBTITLES.hidden, select: () => {} },
      onPickAutoplay,
    })
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
        rendition: { mode: PLAYBACK_MODES.transcode, quality: 'sd480', burn: null },
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

describe('SettingsMenu subtitles', () => {
  const picture = {
    id: 'embedded-0',
    source: SUBTITLE_SOURCES.embedded,
    codec: 'dvd_subtitle',
    language: 'en',
    title: null,
    default: false,
    forced: false,
    hearingImpaired: false,
    supported: false,
  } as const satisfies SubtitleTrack
  const withPicture: TrackSelection = {
    ...selection,
    tracks: { audio: [], subtitles: [picture], defaultAudio: null, frameRate: null },
  }
  type RenderSubtitlesProps = {
    pictures: PictureSubtitles
    onPickCaption?: (change: Partial<CaptionStyle>) => void
  }

  const renderSubtitles = ({ pictures, onPickCaption = () => {} }: RenderSubtitlesProps) =>
    render(
      <SettingsMenu
        section={MENU_SECTIONS.subtitles}
        menuRef={createRef<HTMLDialogElement>()}
        selection={withPicture}
        subtitleStatus="off"
        rate={1}
        mode={PLAYBACK_MODES.direct}
        choices={{ groups: [], pictures, select: () => {} }}
        onPickRate={() => {}}
        autoplay
        onPickAutoplay={() => {}}
        captionStyle={DEFAULT_CAPTION_STYLE}
        onPickCaption={onPickCaption}
        onShowInfo={() => {}}
        onClose={() => {}}
        queue={null}
        onPlayEntry={() => {}}
      />,
    )

  it('lets a picture track be picked when the server can burn it in', () => {
    renderSubtitles({ pictures: PICTURE_SUBTITLES.burned })
    expect(screen.getByRole('radio', { name: /English/ })).toBeEnabled()
  })

  it('keeps a picture track off when nothing can burn it in', () => {
    renderSubtitles({ pictures: PICTURE_SUBTITLES.hidden })
    expect(screen.getByRole('radio', { name: /English/ })).toBeDisabled()
  })

  it("offers the account's subtitle size and colour, the ones it has checked", async () => {
    const onPickCaption = jest.fn()
    renderSubtitles({ pictures: PICTURE_SUBTITLES.hidden, onPickCaption })
    const sizes = within(screen.getByRole('group', { name: 'Subtitle size' }))
    expect(sizes.getAllByRole('radio').map((radio) => radio.parentElement?.textContent)).toEqual([
      'Small',
      'Medium',
      'Large',
      'Largest',
    ])
    expect(sizes.getByRole('radio', { name: 'Medium' })).toBeChecked()
    await userEvent.click(sizes.getByRole('radio', { name: 'Largest' }))
    expect(onPickCaption).toHaveBeenLastCalledWith({ size: CAPTION_SIZES.largest })
    const colours = within(screen.getByRole('group', { name: 'Subtitle colour' }))
    expect(colours.getByRole('radio', { name: 'White' })).toBeChecked()
    await userEvent.click(colours.getByRole('radio', { name: 'Green' }))
    expect(onPickCaption).toHaveBeenLastCalledWith({ colour: CAPTION_COLOURS.green })
  })
})
