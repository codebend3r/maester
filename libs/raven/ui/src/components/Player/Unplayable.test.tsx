import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import {
  MEDIA_ORIGIN_KINDS,
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackDiagnostics,
  isPlaybackDiagnostics,
} from '@raven/core'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { REPORTED_MESSAGE } from '@/components/Player/errorReport'
import { Player } from '@/components/Player/Player'
import type { ErrorReporter } from '@/components/Player/PlayerServices'
import { api } from '@/test/api'
import { setBrowserSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { useHostPlayer } from '@/stores/playerServices'
import { useToasts } from '@/stores/toasts'

const TRACKS: MediaTracks = {
  audio: [
    { index: 0, codec: 'aac', channels: 6, language: 'en', title: null, default: true },
    { index: 1, codec: 'aac', channels: 2, language: 'ja', title: 'Commentary', default: false },
  ],
  subtitles: [],
  defaultAudio: 0,
  frameRate: 24,
}

type ReportingPlayerProps = { media: MediaItem; report?: ErrorReporter }

const ReportingPlayer = ({ media, report }: ReportingPlayerProps) => {
  const isHosting = useHostPlayer({
    title: { label: media.title, duration: media.duration, resumeAt: 42, backTo: '/', next: null },
    posterUrl: null,
    escape: null,
    progress: { started: () => {}, save: () => {}, left: () => {} },
    ...(report && { report }),
  })
  return isHosting && <Player engine={{ kind: 'html', source: { kind: 'server', media, api } }} />
}

type AppProps = { media?: MediaItem; report?: ErrorReporter }

/** The player opened from a library page, as a viewer reaches it. */
const app = ({ media = mediaItem(), report }: AppProps) =>
  renderWithProviders({
    ui: (
      <Routes>
        <Route path="libraries/2" element={<p>The library</p>} />
        <Route path="watch/7" element={<ReportingPlayer media={media} report={report} />} />
      </Routes>
    ),
    route: '/watch/7',
    behind: ['/libraries/2'],
  })

const reporter = (send: (diagnostics: PlaybackDiagnostics) => Promise<unknown>) => {
  const spy = mock(send)
  return { send: spy, report: { appVersion: '1.2.3', send: spy } }
}

const sent = (send: ReturnType<typeof reporter>['send']): PlaybackDiagnostics => {
  const [[diagnostics] = []] = send.mock.calls
  if (!diagnostics) throw new Error('nothing was sent')
  return diagnostics
}

const spies: Array<{ mockRestore: () => void }> = []

beforeEach(() => {
  // Safari's answer to Matroska: no.
  setBrowserSupport((mime) => !mime.startsWith('video/x-matroska'))
  spies.push(spyOn(api, 'getTracks').mockImplementation(async () => TRACKS))
})

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore())
  window.history.replaceState(null, '', '/')
})

describe('Report this error', () => {
  it('is not offered when the host takes no reports', () => {
    app({})
    expect(screen.getByText("This video can't play in this browser.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report this error' })).toBeNull()
  })

  it('sends the file, the device and the browser’s answers in one click, with no ticket', async () => {
    window.history.replaceState(null, '', '/watch/7?t=account.secret')
    useMediaOrigin.setState({
      pick: {
        origin: { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://raven.home.example.com?t=secret' },
        at: Date.UTC(2026, 9, 20),
      },
    })
    const { send, report } = reporter(async () => undefined)
    app({ report })

    await userEvent.click(await screen.findByRole('button', { name: 'Report this error' }))

    expect(send).toHaveBeenCalledTimes(1)
    const diagnostics = sent(send)
    expect(isPlaybackDiagnostics(diagnostics)).toBe(true)
    expect(JSON.stringify(diagnostics)).not.toContain('secret')
    expect(diagnostics).toMatchObject({
      title: 'Busboys (2026)',
      problems: ["The MKV container isn't supported here."],
      media: {
        id: 7,
        fileName: 'Busboys (2026) 1080p WEBRip.mkv',
        container: 'mkv',
        videoCodec: 'hevc',
        videoBitDepth: 10,
        audioCodec: 'aac',
        bitrate: 2_215_000,
      },
      tracks: { audio: { index: 0, language: 'en' }, audioCount: 2, subtitleCount: 0 },
      playback: { modes: [], attempts: [], isForced: false },
      position: { resumeAt: 42, failedAt: null },
      origin: {
        kind: MEDIA_ORIGIN_KINDS.lan,
        url: 'https://raven.home.example.com',
        pickedAt: '2026-10-20T00:00:00.000Z',
      },
      device: { userAgent: navigator.userAgent, isOnline: navigator.onLine },
      app: { version: '1.2.3', page: `${window.location.origin}/watch/7` },
    })
    expect(diagnostics.support.play).toContainEqual({
      type: 'video/x-matroska',
      isSupported: false,
    })
  })

  it('says it was sent, in a toast that outlives the player, and leaves as Back does', async () => {
    const { report } = reporter(async () => undefined)
    app({ report })
    await userEvent.click(await screen.findByRole('button', { name: 'Report this error' }))
    expect(await screen.findByText('The library')).toBeInTheDocument()
    expect(useToasts.getState().toasts.map(({ message }) => message)).toEqual([REPORTED_MESSAGE])
  })

  it('keeps the viewer on the error when it cannot be sent, to try again', async () => {
    const { send, report } = reporter(async () => {
      throw new Error('offline')
    })
    app({ report })
    const button = await screen.findByRole('button', { name: 'Report this error' })
    await userEvent.click(button)

    expect(await screen.findByText('The report could not be sent. Try again.')).toBeInTheDocument()
    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.queryByText('The library')).toBeNull()
    expect(useToasts.getState().toasts).toEqual([])
    await userEvent.click(button)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('holds the button while the report is on its way', async () => {
    const { report } = reporter(() => new Promise(() => {}))
    app({ report })
    const button = await screen.findByRole('button', { name: 'Report this error' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('names the way that failed mid-play, and where it stopped', async () => {
    const { send, report } = reporter(async () => undefined)
    const { container } = app({ media: mediaItem({ container: 'mp4' }), report })
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    if (video) fireEvent.error(video)

    await userEvent.click(await screen.findByRole('button', { name: 'Report this error' }))
    expect(sent(send)).toMatchObject({
      problems: ['Playback stopped unexpectedly.'],
      playback: {
        modes: [PLAYBACK_MODES.direct],
        attempts: [
          { mode: PLAYBACK_MODES.direct, message: 'Playback stopped unexpectedly.', position: 42 },
        ],
      },
      position: { resumeAt: 42, failedAt: 42 },
    })
  })
})
