import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import type { MediaTracks, PlaybackSettingsState, SubtitleTrack } from '@raven/core'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { WatchPlayer as Player } from '@/pages/WatchPage/WatchPage'
import { api } from '@/lib/api'
import { setBrowserSupport, setStreamSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { DEFAULT_PLAYBACK_STATE, renderWithProviders } from '@/test/render'
import { WatchProbe } from '@/test/watchProbe'
import { usePlayerPrefs } from '@/stores/playerPrefs'

const subtitleTrack = (overrides: Partial<SubtitleTrack>): SubtitleTrack => ({
  id: 'embedded-0',
  source: 'embedded',
  codec: 'subrip',
  language: 'en',
  title: null,
  default: false,
  forced: false,
  hearingImpaired: false,
  supported: true,
  ...overrides,
})

const TRACKS: MediaTracks = {
  audio: [
    { index: 0, codec: 'aac', channels: 6, language: 'en', title: null, default: true },
    { index: 1, codec: 'aac', channels: 2, language: 'ja', title: 'Commentary', default: false },
  ],
  subtitles: [
    subtitleTrack({ id: 'embedded-0' }),
    subtitleTrack({
      id: 'embedded-1',
      codec: 'hdmv_pgs_subtitle',
      language: 'ja',
      supported: false,
    }),
  ],
  defaultAudio: 0,
  frameRate: 24,
}

const spies: Array<{ mockRestore: () => void }> = []
const stubTracks = (tracks: MediaTracks = TRACKS) =>
  spies.push(spyOn(api, 'getTracks').mockImplementation(async () => tracks))

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

const press = (key: string) => fireEvent.keyDown(window, { key })

describe('Player', () => {
  // Safari's answer to Matroska: no.
  beforeEach(() => {
    setBrowserSupport((mime) => !mime.startsWith('video/x-matroska'))
    stubTracks()
  })

  it('goes straight to the video when the browser can play the file', () => {
    const { container } = renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', '/api/media/7/file')
    expect(video).toHaveAttribute('autoplay')
    expect(document.activeElement).toBe(video)
  })

  it('explains why a file cannot play instead of loading it', () => {
    const { container } = renderWithProviders(
      <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" />,
    )
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText("This video can't play in this browser.")).toBeInTheDocument()
    expect(screen.getByText("The MKV container isn't supported here.")).toBeInTheDocument()
  })

  it('waits for the server’s playback settings before it picks a source', async () => {
    setStreamSupport(() => true)
    const off: PlaybackSettingsState = {
      ...DEFAULT_PLAYBACK_STATE,
      settings: { ...DEFAULT_PLAYBACK_STATE.settings, transcoding: 'off' },
    }
    spies.push(spyOn(api, 'getPlaybackSettings').mockImplementation(async () => off))
    const { container } = renderWithProviders(
      <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" />,
      { playback: null },
    )
    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
    // Nothing is converted, so the Matroska file has no way to play here.
    expect(await screen.findByText("This video can't play in this browser.")).toBeInTheDocument()
  })

  it('sends the original file under Always, and marks its own audio track as the one playing', async () => {
    const forced: PlaybackSettingsState = {
      ...DEFAULT_PLAYBACK_STATE,
      settings: { ...DEFAULT_PLAYBACK_STATE.settings, directPlay: 'force' },
    }
    const { container } = renderWithProviders(
      <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" />,
      { playback: forced },
    )
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/7/file')
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const menu = await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(
      await within(within(menu).getByRole('group', { name: 'Audio' })).findByRole('radio', {
        name: /Japanese/,
      }),
    )
    // Without a stream to remux into, the file plays on, with its default track.
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/7/file')
    const audio = within(
      within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('group', {
        name: 'Audio',
      }),
    )
    expect(audio.getByRole('radio', { name: /English/ })).toBeChecked()
    expect(audio.getByRole('radio', { name: /Japanese/ })).not.toBeChecked()
  })

  it('lets the viewer try anyway', async () => {
    const { container } = renderWithProviders(
      <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try playing anyway' }))
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/7/file')
  })
})

describe('Player escape feedback', () => {
  beforeEach(() => setBrowserSupport(() => false))

  it('keeps successful clipboard feedback owned by the browser host', async () => {
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockImplementation(async () => {})
    spies.push(clipboard)
    renderWithProviders(<Player media={mediaItem()} upNext={[]} backTo="/libraries/2" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Copy file link' }))
    expect(clipboard).toHaveBeenCalledWith(
      new URL('/api/media/7/file', window.location.origin).href,
    )
    expect(
      await screen.findByText('Link copied. Paste it into VLC or IINA to play it there.'),
    ).toBeInTheDocument()
  })

  it('shows the copyable URL if the browser refuses the clipboard', async () => {
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockImplementation(async () => {
      throw new Error('Clipboard denied')
    })
    spies.push(clipboard)
    renderWithProviders(<Player media={mediaItem()} upNext={[]} backTo="/libraries/2" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Copy file link' }))
    expect(
      await screen.findByText(
        `Copy this link: ${new URL('/api/media/7/file', window.location.origin).href}`,
      ),
    ).toBeInTheDocument()
  })
})

describe('Player progress', () => {
  it('does not overwrite the saved position when the video never started', async () => {
    const saveSpy = spyOn(api, 'saveProgress').mockImplementation(async () => undefined)
    const { container, unmount } = renderWithProviders(
      <Player
        media={mediaItem({ container: 'mp4', position: 600 })}
        upNext={[]}
        backTo="/libraries/2"
      />,
    )
    container.querySelector('video')?.dispatchEvent(new Event('pause'))
    unmount()
    const saved = [...saveSpy.mock.calls]
    saveSpy.mockRestore()
    expect(saved).toEqual([])
  })
})

describe('Player history', () => {
  it('records a play the first time the video plays, and only then', async () => {
    stubTracks()
    const played = spyOn(api, 'recordPlay').mockImplementation(async () => undefined)
    const { container } = renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    const video = container.querySelector('video')
    expect(played).not.toHaveBeenCalled()
    act(() => {
      video?.dispatchEvent(new Event('playing'))
      video?.dispatchEvent(new Event('playing'))
    })
    const calls = [...played.mock.calls]
    played.mockRestore()
    expect(calls).toEqual([[7]])
  })
})

describe('the player controls', () => {
  beforeEach(() => stubTracks())

  it("draws its own controls rather than the browser's", () => {
    const { container } = renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    expect(container.querySelector('video')).not.toHaveAttribute('controls')
    expect(screen.getByRole('button', { name: 'Play (k)' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute(
      'aria-valuetext',
      '0:00 of 1:36:52',
    )
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument()
  })

  it('lists audio, subtitles and speed in the settings menu', async () => {
    renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const menu = await screen.findByRole('dialog', { name: 'Settings' })
    const audio = within(within(menu).getByRole('group', { name: 'Audio' }))
    expect(await audio.findByRole('radio', { name: /English/ })).toBeChecked()
    expect(audio.getByRole('radio', { name: /Japanese/ })).not.toBeChecked()
    const subtitles = within(within(menu).getByRole('group', { name: 'Subtitles' }))
    expect(subtitles.getByRole('radio', { name: 'Off' })).toBeChecked()
    expect(subtitles.getByRole('radio', { name: /Japanese/ })).toBeDisabled()
    expect(within(menu).getByRole('radio', { name: 'Normal' })).toBeChecked()
    expect(within(menu).getByText('Playing the original file')).toBeInTheDocument()
  })

  it('remembers a subtitle choice for the next video', async () => {
    renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const menu = await screen.findByRole('dialog', { name: 'Settings' })
    const subtitles = within(within(menu).getByRole('group', { name: 'Subtitles' }))
    await userEvent.click(await subtitles.findByRole('radio', { name: /^English/ }))
    expect(usePlayerPrefs.getState().subtitles).toEqual({ on: true, language: 'en' })
    expect(screen.getByRole('button', { name: 'Subtitles off (c)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows the cues of the chosen track over the picture', async () => {
    usePlayerPrefs.setState({ subtitles: { on: true, language: 'en' } })
    spies.push(
      spyOn(api, 'getSubtitles').mockImplementation(async () => [
        { start: 0, end: 30, text: 'Hello <i>there</i>' },
      ]),
    )
    renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    expect(await screen.findByText('there')).toHaveClass('italic')
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it("answers YouTube's keys", async () => {
    const { container } = renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    const video = container.querySelector('video')
    if (!video) throw new Error('no video')
    await screen.findByRole('button', { name: 'Subtitles on (c)' })
    await act(async () => {
      await api.getTracks(7)
    })

    press('5')
    expect(video.currentTime).toBeCloseTo(5812.768 / 2, 0)
    press('j')
    expect(video.currentTime).toBeCloseTo(5812.768 / 2 - 10, 0)
    press('Home')
    expect(video.currentTime).toBe(0)

    press('c')
    expect(usePlayerPrefs.getState().subtitles.on).toBe(true)
    press('+')
    expect(usePlayerPrefs.getState().captionScale).toBe(1.25)
    press('>')
    expect(video.playbackRate).toBe(1.25)

    press('?')
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    // With the list open, other keys wait.
    press('l')
    expect(video.currentTime).toBe(0)
    press('Escape')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
  })

  it('leaves keys alone while the volume slider has them', () => {
    const { container } = renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    const video = container.querySelector('video')
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Volume' }), { key: 'l' })
    expect(video?.currentTime).toBe(0)
  })

  it('plays the next video in line once this one ends, and offers it sooner', async () => {
    const upNext = [
      mediaItem({ id: 8, title: 'Busboys 2 (2027)', container: 'mp4' }),
      mediaItem({ id: 9, title: 'Busboys 3 (2028)', container: 'mp4' }),
    ]
    const { container } = renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={
            <Player media={mediaItem({ container: 'mp4' })} upNext={upNext} backTo="/libraries/2" />
          }
        />
        <Route path="watch/:id" element={<WatchProbe />} />
      </Routes>,
    )
    expect(screen.getByRole('link', { name: /^Next: Busboys 2/ })).toHaveAttribute(
      'href',
      '/watch/8',
    )
    const video = container.querySelector('video')
    if (!video) throw new Error('no video')
    fireEvent(video, new Event('ended'))
    expect(await screen.findByText('Playing 8, then 9')).toBeInTheDocument()
  })

  it('offers no next video when none came with it', () => {
    renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    expect(screen.queryByRole('link', { name: /^Next/ })).toBeNull()
  })

  it('steps down through every conversion before giving up', async () => {
    // Says it can stream, but this pretend browser has no MediaSource to stream into.
    setBrowserSupport((mime) => !mime.includes('mlpa'))
    setStreamSupport(() => true)
    renderWithProviders(
      <Player media={mediaItem({ audioCodec: 'truehd' })} upNext={[]} backTo="/libraries/2" />,
    )
    expect(await screen.findByText("This video can't play in this browser.")).toBeInTheDocument()
    expect(screen.getByText("This browser can't play converted video.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try playing anyway' })).toBeNull()
  })
})

describe('the player’s Back', () => {
  beforeEach(() => {
    setBrowserSupport((mime) => !mime.startsWith('video/x-matroska'))
    stubTracks()
  })

  const app = (media = mediaItem({ container: 'mp4' })) => (
    <Routes>
      <Route path="movies/3" element={<p>The movie</p>} />
      <Route path="libraries/2" element={<p>The library</p>} />
      <Route path="watch/7" element={<Player media={media} upNext={[]} backTo="/libraries/2" />} />
    </Routes>
  )

  it('goes back to the page that opened the player', async () => {
    renderWithProviders(app(), { route: '/watch/7', behind: ['/libraries/2', '/movies/3'] })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('The movie')).toBeInTheDocument()
  })

  it('goes back there on Escape too', async () => {
    renderWithProviders(app(), { route: '/watch/7', behind: ['/movies/3'] })
    press('Escape')
    expect(await screen.findByText('The movie')).toBeInTheDocument()
  })

  it('goes back there from a video that cannot play', async () => {
    renderWithProviders(app(mediaItem()), { route: '/watch/7', behind: ['/movies/3'] })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('The movie')).toBeInTheDocument()
  })

  it('goes to the library when the player was opened straight from its address', async () => {
    renderWithProviders(app(), { route: '/watch/7' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('The library')).toBeInTheDocument()
  })
})
