import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import type { MediaItem, MediaTracks, SubtitleTrack } from '@raven/core'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { WatchProbe } from '@/test/watchProbe'
import { WatchPlayer as Player, WatchPage } from '@/pages/WatchPage/WatchPage'
import { api } from '@/lib/api'
import { setBrowserSupport } from '@/test/canPlay'
import { mediaItem } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

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
    act(() => {
      container.querySelector('video')?.dispatchEvent(new Event('pause'))
    })
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

describe('shared player capability module', () => {
  it('uses the public canPlay module mock inside the built player', () => {
    setBrowserSupport(() => false)
    const { container } = renderWithProviders(
      <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    )
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText("This video can't play in this browser.")).toBeInTheDocument()
  })
})

describe('WatchPage favourite', () => {
  beforeEach(() => stubTracks())

  it('favourites the video while it plays, showing the heart before the server answers', async () => {
    // The server's copy of the video, which a favourite changes and every read returns.
    let saved: MediaItem = mediaItem({ container: 'mp4', favourite: false })
    spies.push(spyOn(api, 'getMedia').mockImplementation(async () => saved))
    const answer = held<MediaItem>()
    const setFavourite = spyOn(api, 'setFavourite').mockImplementation(({ favourite }) => {
      saved = { ...saved, favourite }
      return answer.promise
    })
    spies.push(setFavourite)
    renderWithProviders(
      <Routes>
        <Route path="watch/:id" element={<WatchPage />} />
      </Routes>,
      { route: '/watch/7' },
    )
    const heart = await screen.findByRole('button', { name: 'Favourite' })
    expect(heart).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(heart)
    await waitFor(() => expect(heart).toHaveAttribute('aria-pressed', 'true'))
    expect(setFavourite).toHaveBeenCalledWith({ id: 7, favourite: true })

    await act(async () => answer.answer(saved))
    expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

describe('WatchPlayer up next', () => {
  beforeEach(() => stubTracks())

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
})
