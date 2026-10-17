import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  type MediaItem,
  type MediaTracks,
  PLAY_LINK_MAX_NEXT,
  playLinkFor,
  type SubtitleTrack,
} from '@raven/core'
import { useMediaOrigin, usePlayerPrefs } from '@raven/ui'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { WatchProbe } from '@/test/watchProbe'
import { WatchPlayer as Player, WatchPage } from '@/pages/WatchPage/WatchPage'
import { api } from '@/lib/api'
import { ravenPlayer } from '@/lib/ravenPlayer'
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
  useMediaOrigin.setState({ pick: null, isProbing: false })
})

describe('Player escape feedback', () => {
  beforeEach(() => setBrowserSupport(() => false))

  it('keeps successful clipboard feedback owned by the browser host', async () => {
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockImplementation(async () => {})
    spies.push(clipboard)
    renderWithProviders({ ui: <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" /> })
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
    renderWithProviders({ ui: <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" /> })
    await userEvent.click(await screen.findByRole('button', { name: 'Copy file link' }))
    expect(
      await screen.findByText(
        `Copy this link: ${new URL('/api/media/7/file', window.location.origin).href}`,
      ),
    ).toBeInTheDocument()
  })
})

describe('Player file link on the media plane', () => {
  beforeEach(() => setBrowserSupport(() => false))

  const lan = { kind: 'lan', url: 'https://raven.home.example' } as const

  it('copies a ticketed link on the picked origin and says how long it works', async () => {
    useMediaOrigin.setState({ pick: { origin: lan, at: Date.now() } })
    spies.push(spyOn(api, 'getMediaOrigins').mockImplementation(async () => ({ origins: [lan] })))
    spies.push(
      spyOn(api, 'getMediaTicket').mockImplementation(async () => ({
        ticket: 'abc.def',
        expiresAt: Date.now() + 21_600_000,
      })),
    )
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockImplementation(async () => {})
    spies.push(clipboard)
    renderWithProviders({ ui: <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" /> })
    await waitFor(() => expect(api.getMediaTicket).toHaveBeenCalledWith(7))
    // The link is built from the ticket, so the click waits until the page holds one.
    await waitFor(async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Copy file link' }))
      expect(clipboard).toHaveBeenLastCalledWith(
        'https://raven.home.example/api/media/7/file?t=abc.def',
      )
    })
    expect(
      await screen.findByText(
        'Link copied. Paste it into VLC or IINA to play it there; it works for 6 hours.',
      ),
    ).toBeInTheDocument()
  })

  it("copies the web host link without a pick, with today's message", async () => {
    spies.push(spyOn(api, 'getMediaOrigins').mockImplementation(async () => ({ origins: [] })))
    const clipboard = spyOn(navigator.clipboard, 'writeText').mockImplementation(async () => {})
    spies.push(clipboard)
    renderWithProviders({ ui: <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" /> })
    await waitFor(() => expect(api.getMediaOrigins).toHaveBeenCalled())
    await userEvent.click(await screen.findByRole('button', { name: 'Copy file link' }))
    expect(clipboard).toHaveBeenCalledWith(
      new URL('/api/media/7/file', window.location.origin).href,
    )
    expect(
      await screen.findByText('Link copied. Paste it into VLC or IINA to play it there.'),
    ).toBeInTheDocument()
  })
})

describe('Player progress', () => {
  it('does not overwrite the saved position when the video never started', async () => {
    const saveSpy = spyOn(api, 'saveProgress').mockImplementation(async () => undefined)
    const { container, unmount } = renderWithProviders({
      ui: (
        <Player
          media={mediaItem({ container: 'mp4', position: 600 })}
          upNext={[]}
          backTo="/libraries/2"
        />
      ),
    })
    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('pause'))
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
    const { container } = renderWithProviders({
      ui: <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    })
    const video = container.querySelector('video')!
    expect(played).not.toHaveBeenCalled()
    act(() => {
      video.dispatchEvent(new Event('playing'))
      video.dispatchEvent(new Event('playing'))
    })
    const calls = [...played.mock.calls]
    played.mockRestore()
    expect(calls).toEqual([[7]])
  })
})

describe('shared player capability module', () => {
  it('uses the public canPlay module mock inside the built player', () => {
    setBrowserSupport(() => false)
    const { container } = renderWithProviders({
      ui: <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    })
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
    renderWithProviders({
      ui: (
        <Routes>
          <Route path="watch/:id" element={<WatchPage />} />
        </Routes>
      ),
      route: '/watch/7',
    })
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
    const { container } = renderWithProviders({
      ui: (
        <Routes>
          <Route
            path="/"
            element={
              <Player
                media={mediaItem({ container: 'mp4' })}
                upNext={upNext}
                backTo="/libraries/2"
              />
            }
          />
          <Route path="watch/:id" element={<WatchProbe />} />
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
    expect(await screen.findByText('Playing 8, then 9')).toBeInTheDocument()
  })
})

describe('WatchPlayer Open in raven player', () => {
  const opened = () => {
    const open = spyOn(ravenPlayer, 'open').mockImplementation(() => {})
    spies.push(open)
    return open
  }

  /** A title this browser plays, playing at `seconds` into the file. */
  const playingAt = ({ video, seconds }: { video: HTMLVideoElement; seconds: number }) => {
    Object.defineProperties(video, {
      readyState: { value: HTMLMediaElement.HAVE_METADATA, configurable: true },
      currentTime: { value: seconds, writable: true, configurable: true },
    })
    act(() => {
      video.dispatchEvent(new Event('playing'))
      video.dispatchEvent(new Event('timeupdate'))
    })
  }

  const unplayableButtons = () =>
    within(screen.getByRole('region', { name: 'Busboys (2026)' }))
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((name) => name !== 'Back')

  beforeEach(() => stubTracks())

  it('offers nothing on Unplayable while this browser has not asked for it', async () => {
    setBrowserSupport(() => false)
    renderWithProviders({ ui: <Player media={mediaItem()} upNext={[]} backTo="/libraries/2" /> })
    await screen.findByRole('button', { name: 'Copy file link' })
    expect(screen.queryByRole('button', { name: 'Open in raven player' })).toBeNull()
  })

  it('offers nothing in the playback menu while this browser has not asked for it', async () => {
    renderWithProviders({
      ui: <Player media={mediaItem({ container: 'mp4' })} upNext={[]} backTo="/libraries/2" />,
    })
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    const menu = await screen.findByRole('dialog', { name: 'Playback' })
    expect(within(menu).queryByRole('button', { name: 'Open in raven player' })).toBeNull()
  })

  it('offers it first on Unplayable once asked for, with the title and its up next', async () => {
    const open = opened()
    setBrowserSupport(() => false)
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    renderWithProviders({
      ui: (
        <Player
          media={mediaItem()}
          upNext={[mediaItem({ id: 8 }), mediaItem({ id: 9 })]}
          backTo="/libraries/2"
        />
      ),
    })
    await screen.findByRole('button', { name: 'Copy file link' })
    expect(unplayableButtons()).toEqual([
      'Open in raven player',
      'Try playing anyway',
      'Copy file link',
    ])
    // The built library hashes its class names, so the tone is matched by its stem.
    expect(screen.getByRole('button', { name: 'Open in raven player' }).className).toMatch(
      /primary/,
    )
    expect(screen.getByRole('button', { name: 'Try playing anyway' }).className).not.toMatch(
      /primary/,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open in raven player' }))
    // Written out, so a change to the link's shape fails here as well as in core.
    expect(open.mock.calls).toEqual([
      ['raven://play?server=http%3A%2F%2Flocalhost%3A8484&media=7&at=0&next=8%2C9'],
    ])
  })

  it('opens an Unplayable title where its saved position left it', async () => {
    const open = opened()
    setBrowserSupport(() => false)
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    renderWithProviders({
      ui: (
        <Player
          media={mediaItem({ position: 600, duration: 7200 })}
          upNext={[]}
          backTo="/libraries/2"
        />
      ),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Open in raven player' }))
    expect(open.mock.calls).toEqual([
      [playLinkFor({ origin: window.location.origin, mediaId: 7, at: 600, next: [] })],
    ])
  })

  it('pauses a playing title, then opens it at the whole second it reached', async () => {
    const order: string[] = []
    const open = opened()
    open.mockImplementation(() => {
      order.push('open')
    })
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    const { container } = renderWithProviders({
      ui: (
        <Player
          media={mediaItem({ container: 'mp4' })}
          upNext={[mediaItem({ id: 8 })]}
          backTo="/libraries/2"
        />
      ),
    })
    const video = container.querySelector('video')
    if (!video) throw new Error('no video')
    spies.push(
      spyOn(video, 'pause').mockImplementation(() => {
        order.push('pause')
      }),
    )
    playingAt({ video, seconds: 42.7 })
    await userEvent.click(screen.getByRole('button', { name: /^Playback:/ }))
    const menu = await screen.findByRole('dialog', { name: 'Playback' })
    await userEvent.click(within(menu).getByRole('button', { name: 'Open in raven player' }))
    expect(order).toEqual(['pause', 'open'])
    expect(open.mock.calls).toEqual([
      [playLinkFor({ origin: window.location.origin, mediaId: 7, at: 42, next: [8] })],
    ])
  })

  it('hands over only the up next ids a link can carry, and no more of them than it holds', async () => {
    const open = opened()
    setBrowserSupport(() => false)
    usePlayerPrefs.setState({ opensInRavenPlayer: true })
    const playable = Array.from({ length: PLAY_LINK_MAX_NEXT + 5 }, (_, index) =>
      mediaItem({ id: index + 8 }),
    )
    const upNext = [mediaItem({ id: 0 }), mediaItem({ id: 1.5 }), ...playable]
    renderWithProviders({
      ui: <Player media={mediaItem()} upNext={upNext} backTo="/libraries/2" />,
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Open in raven player' }))
    const next = playable.slice(0, PLAY_LINK_MAX_NEXT).map(({ id }) => id)
    expect(open.mock.calls).toEqual([
      [playLinkFor({ origin: window.location.origin, mediaId: 7, at: 0, next })],
    ])
  })
})
