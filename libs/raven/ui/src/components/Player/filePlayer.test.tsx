import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import {
  DEFAULT_CAPTION_STYLE,
  PLAYER_SOURCE_KINDS,
  SUBTITLE_SOURCES,
  type SubtitleCue,
  type SubtitleTrack,
} from '@raven/core'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ENGINE_KINDS, type FileSubtitles } from '@/components/Player/engine'
import { Player } from '@/components/Player/Player'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useHostPlayer } from '@/stores/playerServices'
import { api } from '@/test/api'
import { renderWithProviders } from '@/test/render'
import { NO_TITLE_EXTRAS, NO_HOST_EXTRAS } from '@/components/Player/PlayerServices'

const URL = 'blob:raven/clip'

type FilePlayerProps = { subtitles?: FileSubtitles }

/** A host of a local file, as the browser's player of a download is. */
const FilePlayer = ({ subtitles }: FilePlayerProps) => {
  const isHosting = useHostPlayer({
    title: {
      ...NO_TITLE_EXTRAS,
      label: 'Clip 01',
      duration: null,
      resumeAt: 0,
      backTo: '/downloads',
      next: null,
    },
    posterUrl: null,
    ...NO_HOST_EXTRAS,
    escape: null,
    progress: { started: () => {}, save: () => {}, left: () => {}, duration: null },
  })
  return (
    isHosting && (
      <Player
        engine={{
          kind: ENGINE_KINDS.html,
          source: { kind: PLAYER_SOURCE_KINDS.file, url: URL, subtitles },
        }}
      />
    )
  )
}

const track = (overrides: Partial<SubtitleTrack>): SubtitleTrack => ({
  id: 'external-0',
  source: SUBTITLE_SOURCES.external,
  codec: 'srt',
  language: 'en',
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...overrides,
})

const CUES: SubtitleCue[] = [{ start: 1, end: 4, text: 'Kept beside the file' }]

const keptOf = (read: FileSubtitles['read'] = async () => CUES): FileSubtitles => ({
  tracks: [
    track({}),
    track({ id: 'embedded-0', source: SUBTITLE_SOURCES.embedded, language: 'fr' }),
  ],
  read,
})

const playTo = (time: number) => {
  const video = document.querySelector('video')
  if (video === null) throw new Error('no video element')
  video.currentTime = time
  fireEvent(video, new Event('timeupdate'))
}

describe('Player of a local file', () => {
  const captions = spyOn(api, 'getCaptionStyle').mockImplementation(
    async () => DEFAULT_CAPTION_STYLE,
  )

  afterEach(() => captions.mockClear())

  it('plays the file at its address, with no track to pick when its host kept none', async () => {
    renderWithProviders({ ui: <FilePlayer /> })
    await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', URL))
    await userEvent.click(await screen.findByRole('button', { name: 'Subtitles: Off' }))
    const menu = await screen.findByRole('dialog', { name: 'Subtitles' })
    expect(within(menu).queryByRole('radio', { name: /^English/ })).toBeNull()
  })

  it('offers the subtitles its host kept, and draws the one picked from the cues it reads', async () => {
    const read = mock<FileSubtitles['read']>(async () => CUES)
    renderWithProviders({ ui: <FilePlayer subtitles={keptOf(read)} /> })
    await userEvent.click(await screen.findByRole('button', { name: 'Subtitles: Off' }))
    const menu = await screen.findByRole('dialog', { name: 'Subtitles' })
    const offered = within(within(menu).getByRole('group', { name: 'Subtitles' }))
    expect(offered.getByRole('radio', { name: /^French/ })).toBeInTheDocument()
    await userEvent.click(offered.getByRole('radio', { name: /^English/ }))
    expect(usePlayerPrefs.getState().subtitles).toEqual({ on: true, language: 'en' })
    await waitFor(() => expect(read).toHaveBeenCalledWith('external-0'))
    playTo(2)
    expect(await screen.findByText('Kept beside the file')).toBeInTheDocument()
    await userEvent.click(offered.getByRole('radio', { name: 'Off' }))
    expect(usePlayerPrefs.getState().subtitles.on).toBe(false)
    await waitFor(() => expect(screen.queryByText('Kept beside the file')).toBeNull())
  })

  it('starts with the remembered subtitle language on, as a server video does', async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: 'fr' } })
    const read = mock<FileSubtitles['read']>(async () => CUES)
    renderWithProviders({ ui: <FilePlayer subtitles={keptOf(read)} /> })
    expect(await screen.findByRole('button', { name: 'Subtitles: French' })).toBeInTheDocument()
    await waitFor(() => expect(read).toHaveBeenCalledWith('embedded-0'))
  })

  it('plays on when a kept track cannot be read', async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: 'en' } })
    const read = mock<FileSubtitles['read']>(async () => {
      throw new Error('The file is gone.')
    })
    renderWithProviders({ ui: <FilePlayer subtitles={keptOf(read)} /> })
    await waitFor(() => expect(read).toHaveBeenCalled())
    playTo(2)
    expect(document.querySelector('video')).toHaveAttribute('src', URL)
    expect(screen.queryByText('Kept beside the file')).toBeNull()
  })
})
