import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import {
  type MediaItem,
  type MediaTracks,
  type PlaybackSettingsState,
  type SubtitleTrack,
} from '@raven/core'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Route, Routes, useNavigationType } from 'react-router-dom'
import { Player } from '@/components/Player/Player'
import type { PlayerFavourite, PlayerTitle } from '@/components/Player/PlayerServices'
import { api } from '@/test/api'
import { setBrowserSupport, setStreamSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { DEFAULT_PLAYBACK_STATE, renderWithProviders } from '@/test/render'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useHostPlayer } from '@/stores/playerServices'

/** A host as the web's is: new services on every render, the player only once they are in the store. */
const TestPlayer = ({
  media,
  backTo,
  next = null,
  favourite,
}: {
  media: MediaItem
  backTo: string
  next?: PlayerTitle['next']
  favourite?: PlayerFavourite
}) => {
  const isHosting = useHostPlayer({
    title: { label: media.title, duration: media.duration, resumeAt: 0, backTo, next },
    posterUrl: null,
    escape: null,
    progress: { started: () => {}, save: () => {}, left: () => {} },
    ...(favourite && { favourite }),
  })
  return isHosting && <Player engine={{ kind: 'html', source: { kind: 'server', media, api } }} />
}

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
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', '/api/media/7/file')
    expect(video).toHaveAttribute('autoplay')
    expect(document.activeElement).toBe(video)
  })

  it('explains why a file cannot play instead of loading it', () => {
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem()} backTo="/libraries/2" />,
    })
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
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem()} backTo="/libraries/2" />,
      playback: null,
    })
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
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem()} backTo="/libraries/2" />,
      playback: forced,
    })
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/7/file')
    await userEvent.click(screen.getByRole('button', { name: /^Audio/ }))
    const menu = await screen.findByRole('dialog', { name: 'Audio' })
    await userEvent.click(
      await within(within(menu).getByRole('group', { name: 'Audio' })).findByRole('radio', {
        name: /Japanese/,
      }),
    )
    // Without a stream to remux into, the file plays on, with its default track.
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/7/file')
    const audio = within(
      within(await screen.findByRole('dialog', { name: 'Audio' })).getByRole('group', {
        name: 'Audio',
      }),
    )
    expect(audio.getByRole('radio', { name: /English/ })).toBeChecked()
    expect(audio.getByRole('radio', { name: /Japanese/ })).not.toBeChecked()
  })

  it('lets the viewer try anyway', async () => {
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem()} backTo="/libraries/2" />,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Try playing anyway' }))
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/media/7/file')
  })
})

describe('the player controls', () => {
  beforeEach(() => {
    stubTracks()
    spies.push(spyOn(api, 'getSubtitles').mockImplementation(async () => []))
  })

  it("draws its own controls rather than the browser's", () => {
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    expect(container.querySelector('video')).not.toHaveAttribute('controls')
    expect(screen.getByRole('button', { name: 'Play (k)' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute(
      'aria-valuetext',
      '0:00 of 1:36:52',
    )
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument()
  })

  it('lists audio, subtitles and speed in the menus their pills open', async () => {
    renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    await userEvent.click(screen.getByRole('button', { name: /^Audio/ }))
    const audioMenu = await screen.findByRole('dialog', { name: 'Audio' })
    const audio = within(within(audioMenu).getByRole('group', { name: 'Audio' }))
    expect(await audio.findByRole('radio', { name: /English/ })).toBeChecked()
    expect(audio.getByRole('radio', { name: /Japanese/ })).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: /^Subtitles/ }))
    const subtitleMenu = await screen.findByRole('dialog', { name: 'Subtitles' })
    expect(screen.queryByRole('dialog', { name: 'Audio' })).toBeNull()
    const subtitles = within(within(subtitleMenu).getByRole('group', { name: 'Subtitles' }))
    expect(subtitles.getByRole('radio', { name: 'Off' })).toBeChecked()
    expect(subtitles.getByRole('radio', { name: /Japanese/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    const playback = await screen.findByRole('dialog', { name: 'Playback' })
    expect(within(playback).getByRole('radio', { name: 'Normal' })).toBeChecked()
    expect(within(playback).getByText('Playing the original file')).toBeInTheDocument()
  })

  it('opens Playback info from the Playback menu and keeps it over the video until closed', async () => {
    spies.push(
      spyOn(api, 'getStreams').mockImplementation(async () => ({ video: null, audio: [] })),
    )
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    const menu = await screen.findByRole('dialog', { name: 'Playback' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Playback info' }))
    expect(screen.queryByRole('dialog', { name: 'Playback' })).toBeNull()
    const info = screen.getByRole('dialog', { name: 'Playback info' })
    expect(within(info).getByText('HTML video')).toBeInTheDocument()
    expect(within(info).getByText('Direct play')).toBeInTheDocument()
    expect(within(info).getByText('MP4')).toBeInTheDocument()
    // The menu opens again beside it.
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    expect(await screen.findByRole('dialog', { name: 'Playback' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Playback info' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close playback info' }))
    expect(screen.queryByRole('dialog', { name: 'Playback info' })).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('video'))
  })

  it('remembers a subtitle choice for the next video', async () => {
    renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Subtitles: Off' }))
    const menu = await screen.findByRole('dialog', { name: 'Subtitles' })
    const subtitles = within(within(menu).getByRole('group', { name: 'Subtitles' }))
    await userEvent.click(await subtitles.findByRole('radio', { name: /^English/ }))
    expect(usePlayerPrefs.getState().subtitles).toEqual({ on: true, language: 'en' })
    expect(screen.getByRole('button', { name: 'Subtitles: English' })).toHaveAttribute(
      'aria-expanded',
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
    renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    expect(await screen.findByText('there')).toHaveClass('italic')
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it("answers YouTube's keys", async () => {
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    const video = container.querySelector('video')
    if (!video) throw new Error('no video')
    await screen.findByRole('button', { name: 'Subtitles: Off' })
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
    const { container } = renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    const video = container.querySelector('video')
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Volume' }), { key: 'l' })
    expect(video?.currentTime ?? null).toBe(0)
  })

  it('plays the next video in line once this one ends, and offers it sooner', async () => {
    const upNext = [
      mediaItem({ id: 8, title: 'Busboys 2 (2027)', container: 'mp4' }),
      mediaItem({ id: 9, title: 'Busboys 3 (2028)', container: 'mp4' }),
    ]
    const { container } = renderWithProviders({
      ui: (
        <Routes>
          <Route
            path="/"
            element={
              <TestPlayer
                media={mediaItem({ container: 'mp4' })}
                next={{ to: '/watch/8', state: { remaining: 9 }, label: upNext[0]?.title ?? '' }}
                backTo="/libraries/2"
              />
            }
          />
          <Route path="watch/:id" element={<p>Playing the next video</p>} />
        </Routes>
      ),
    })
    expect(screen.getByRole('link', { name: /^Next: Busboys 2/ })).toHaveAttribute(
      'href',
      '/watch/8',
    )
    const video = container.querySelector('video')
    if (!video) throw new Error('no video')
    fireEvent(video, new Event('ended'))
    expect(await screen.findByText('Playing the next video')).toBeInTheDocument()
  })

  it('offers no next video when none came with it', () => {
    renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    expect(screen.queryByRole('link', { name: /^Next/ })).toBeNull()
  })

  it('favourites the video from the player, and says so', async () => {
    /** The host keeps the favourite; the player only shows it and asks for the change. */
    const FavouriteHost = () => {
      const [isFavourite, setFavourite] = useState(false)
      return (
        <TestPlayer
          media={mediaItem({ container: 'mp4' })}
          backTo="/libraries/2"
          favourite={{ isFavourite, toggle: () => setFavourite((marked) => !marked) }}
        />
      )
    }
    renderWithProviders({ ui: <FavouriteHost /> })
    const heart = screen.getByRole('button', { name: 'Favourite' })
    expect(heart).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(heart)
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Added to favourites')).not.toHaveLength(0)

    await userEvent.click(heart)
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByText('Removed from favourites')).not.toHaveLength(0)
  })

  it('offers no heart when the host keeps no favourites', () => {
    renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
    expect(screen.queryByRole('button', { name: 'Favourite' })).toBeNull()
  })

  it('steps down through every conversion before giving up', async () => {
    // Says it can stream, but this pretend browser has no MediaSource to stream into.
    setBrowserSupport((mime) => !mime.includes('mlpa'))
    setStreamSupport(() => true)
    renderWithProviders({
      ui: <TestPlayer media={mediaItem({ audioCodec: 'truehd' })} backTo="/libraries/2" />,
    })
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
      <Route path="watch/7" element={<TestPlayer media={media} backTo="/libraries/2" />} />
    </Routes>
  )

  it('goes back to the page that opened the player', async () => {
    renderWithProviders({ ui: app(), route: '/watch/7', behind: ['/libraries/2', '/movies/3'] })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('The movie')).toBeInTheDocument()
  })

  it('goes back there on Escape too', async () => {
    renderWithProviders({ ui: app(), route: '/watch/7', behind: ['/movies/3'] })
    press('Escape')
    expect(await screen.findByText('The movie')).toBeInTheDocument()
  })

  it('puts Playback info away on Escape before it goes back', async () => {
    spies.push(
      spyOn(api, 'getStreams').mockImplementation(async () => ({ video: null, audio: [] })),
    )
    renderWithProviders({ ui: app(), route: '/watch/7', behind: ['/movies/3'] })
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    const menu = await screen.findByRole('dialog', { name: 'Playback' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Playback info' }))
    expect(screen.getByRole('dialog', { name: 'Playback info' })).toBeInTheDocument()
    press('Escape')
    expect(screen.queryByRole('dialog', { name: 'Playback info' })).toBeNull()
    expect(screen.queryByText('The movie')).toBeNull()
    press('Escape')
    expect(await screen.findByText('The movie')).toBeInTheDocument()
  })

  it("leaves a host dialog's keys to it, Escape included", async () => {
    const { container } = renderWithProviders({
      ui: (
        <Routes>
          <Route path="movies/3" element={<p>The movie</p>} />
          <Route
            path="watch/7"
            element={
              <>
                <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />
                <dialog open aria-label="Open a link">
                  <input aria-label="Link" />
                  <button type="button">Open</button>
                </dialog>
              </>
            }
          />
        </Routes>
      ),
      route: '/watch/7',
      behind: ['/movies/3'],
    })
    const video = container.querySelector('video')
    if (!video) throw new Error('no video')
    const host = screen.getByRole('dialog', { name: 'Open a link' })
    const escape = fireEvent.keyDown(within(host).getByRole('textbox', { name: 'Link' }), {
      key: 'Escape',
    })
    expect(escape).toBe(true)
    fireEvent.keyDown(within(host).getByRole('button', { name: 'Open' }), { key: 'l' })
    expect(video.currentTime).toBe(0)
    expect(screen.queryByText('The movie')).toBeNull()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('goes back there from a video that cannot play', async () => {
    renderWithProviders({ ui: app(mediaItem()), route: '/watch/7', behind: ['/movies/3'] })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('The movie')).toBeInTheDocument()
  })

  it('goes to the library when the player was opened straight from its address', async () => {
    renderWithProviders({ ui: app(), route: '/watch/7' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('The library')).toBeInTheDocument()
  })

  it('replaces the player with the library, so the library has no way back into the video', async () => {
    const Arrival = () => <p>{`The library, by ${useNavigationType()}`}</p>
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="libraries/2" element={<Arrival />} />
          <Route
            path="watch/7"
            element={<TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />}
          />
        </Routes>
      ),
      route: '/watch/7',
    })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('The library, by REPLACE')).toBeInTheDocument()
  })
})

describe('the player chrome', () => {
  beforeEach(() => {
    stubTracks()
    spies.push(spyOn(api, 'getSubtitles').mockImplementation(async () => []))
  })

  const uhd = mediaItem({
    container: 'mp4',
    title: 'Busboys',
    year: 2026,
    width: 3840,
    height: 2160,
    hdr: true,
  })

  it('says under the title what is playing and how, and the pills say what each is set to', async () => {
    renderWithProviders({ ui: <TestPlayer media={uhd} backTo="/libraries/2" /> })
    expect(screen.getByRole('heading', { level: 1, name: 'Busboys' })).toBeInTheDocument()
    expect(screen.getByText('2026 · 4K HDR · Direct play')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subtitles: Off' })).toHaveTextContent(
      'Subtitles · Off',
    )
    expect(await screen.findByRole('button', { name: 'Audio: English 5.1' })).toHaveTextContent(
      'Audio · English 5.1',
    )
    expect(screen.getByRole('button', { name: 'Playback: 4K · Direct play' })).toHaveTextContent(
      /^4K · Direct play$/,
    )
    expect(screen.getByRole('button', { name: 'Full screen (f)' })).toHaveTextContent('Full screen')
  })

  it('opens one menu at a time and gives focus back to its pill', async () => {
    renderWithProviders({ ui: <TestPlayer media={uhd} backTo="/libraries/2" /> })
    const audioPill = await screen.findByRole('button', { name: 'Audio: English 5.1' })
    await userEvent.click(audioPill)
    expect(audioPill).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('dialog', { name: 'Audio' })
    expect(document.activeElement).toBe(within(menu).getByRole('radio', { name: /English/ }))
    // A key press on another pill switches straight to its menu, keyboard and all.
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles: Off' }))
    const subtitleMenu = screen.getByRole('dialog', { name: 'Subtitles' })
    expect(document.activeElement).toBe(within(subtitleMenu).getByRole('radio', { name: 'Off' }))
    fireEvent.click(audioPill)
    press('Escape')
    expect(screen.queryByRole('dialog', { name: 'Audio' })).toBeNull()
    expect(document.activeElement).toBe(audioPill)
    expect(audioPill).toHaveAttribute('aria-expanded', 'false')

    const subtitlesPill = screen.getByRole('button', { name: 'Subtitles: Off' })
    await userEvent.click(subtitlesPill)
    expect(screen.getByRole('dialog', { name: 'Subtitles' })).toBeInTheDocument()
    await userEvent.click(subtitlesPill)
    expect(screen.queryByRole('dialog', { name: 'Subtitles' })).toBeNull()
    expect(document.activeElement).toBe(subtitlesPill)

    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('dialog', { name: 'Playback' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    await userEvent.click(screen.getByRole('slider', { name: 'Seek' }))
    expect(screen.queryByRole('dialog', { name: 'Playback' })).toBeNull()
  })

  it('keeps the heart in the top bar beside the title, filled once favourited', () => {
    renderWithProviders({
      ui: (
        <TestPlayer
          media={uhd}
          backTo="/libraries/2"
          favourite={{ isFavourite: true, toggle: () => {} }}
        />
      ),
    })
    const heart = screen.getByRole('button', { name: 'Favourite' })
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    expect(heart).toHaveClass('favourited')
    expect(heart.closest('header')).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Busboys' }),
    )
  })

  it('shows a large play mark while paused, and drops it once the video plays', () => {
    const { container } = renderWithProviders({
      ui: <TestPlayer media={uhd} backTo="/libraries/2" />,
    })
    const video = container.querySelector('video')
    if (!video) throw new Error('no video')
    expect(container.querySelector('.paused')).toHaveAttribute('aria-hidden', 'true')
    act(() => {
      video.dispatchEvent(new Event('play'))
      video.dispatchEvent(new Event('playing'))
    })
    expect(container.querySelector('.paused')).toBeNull()
    expect(screen.getByRole('button', { name: 'Pause (k)' })).toBeInTheDocument()
  })

  it('skips ten seconds either way from the bar', async () => {
    const { container } = renderWithProviders({
      ui: <TestPlayer media={uhd} backTo="/libraries/2" />,
    })
    const video = container.querySelector('video')
    if (!video) throw new Error('no video')
    const forward = screen.getByRole('button', { name: 'Forward 10 seconds (l)' })
    expect(forward).toHaveTextContent('+10')
    await userEvent.click(forward)
    expect(video.currentTime).toBe(10)
    const back = screen.getByRole('button', { name: 'Back 10 seconds (j)' })
    expect(back).toHaveTextContent('-10')
    await userEvent.click(back)
    expect(video.currentTime).toBe(0)
  })
})

// Last in the file: with the fake timers ahead of them, the Back tests above time out.
describe('the controls fading out', () => {
  const IDLE_MS = 10_000
  beforeEach(() => {
    stubTracks()
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  const renderPlayer = () =>
    renderWithProviders({
      ui: <TestPlayer media={mediaItem({ container: 'mp4' })} backTo="/libraries/2" />,
    })
  const bar = () => screen.getByRole('slider', { name: 'Seek' }).closest('.controls')
  const idle = (ms: number) => act(() => jest.advanceTimersByTime(ms))

  it('hides the controls and the cursor after ten idle seconds, paused or not', () => {
    const { container } = renderPlayer()
    idle(IDLE_MS - 1)
    expect(bar()).not.toHaveClass('hidden')
    idle(1)
    expect(bar()).toHaveClass('hidden')
    expect(container.querySelector('.chrome')).toHaveClass('chromeHidden')
    expect(container.querySelector('.stage')).toHaveClass('idle')
  })

  it.each([
    ['a mouse move', () => fireEvent.pointerMove(screen.getByRole('slider', { name: 'Seek' }))],
    ['a key press', () => press('x')],
    ['a click', () => fireEvent.pointerDown(screen.getByRole('slider', { name: 'Seek' }))],
  ])('brings them back on %s, and hides them again ten seconds later', (_name, wake) => {
    renderPlayer()
    idle(IDLE_MS)
    expect(bar()).toHaveClass('hidden')
    act(() => wake())
    expect(bar()).not.toHaveClass('hidden')
    idle(IDLE_MS - 1)
    expect(bar()).not.toHaveClass('hidden')
    idle(1)
    expect(bar()).toHaveClass('hidden')
  })

  it('hides them although a control still has focus', () => {
    renderPlayer()
    act(() => screen.getByRole('button', { name: 'Play (k)' }).focus())
    idle(IDLE_MS)
    expect(bar()).toHaveClass('hidden')
  })

  it('hides them while a menu is open', () => {
    renderPlayer()
    act(() => screen.getByRole('button', { name: /^Playback:/ }).click())
    expect(screen.getByRole('dialog', { name: 'Playback' })).toBeInTheDocument()
    idle(IDLE_MS)
    expect(bar()).toHaveClass('hidden')
  })

  it('counts a key pressed on the volume slider as stirring', () => {
    renderPlayer()
    idle(IDLE_MS - 1)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Volume' }), { key: 'ArrowLeft' })
    idle(1)
    expect(bar()).not.toHaveClass('hidden')
  })
})
