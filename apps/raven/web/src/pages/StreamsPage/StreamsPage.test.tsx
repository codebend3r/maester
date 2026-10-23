import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  ApiError,
  type MediaStreams,
  type MediaTracks,
  PLAYBACK_MODES,
  VIDEO_RANGES,
} from '@raven/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { StreamsPage } from '@/pages/StreamsPage/StreamsPage'
import { fakeAccount } from '@/test/authClient'
import { itemSummary, liveStream, mediaItem } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const TRACKS: MediaTracks = {
  audio: [
    { index: 0, codec: 'truehd', channels: 8, language: 'en', title: null, default: true },
    { index: 1, codec: 'ac3', channels: 6, language: 'es', title: null, default: false },
  ],
  subtitles: [],
  defaultAudio: 0,
  frameRate: 23.976,
}

const PROBE: MediaStreams = {
  video: { codec: 'hevc', profile: 'Main 10', bitrate: 38_100_000, range: VIDEO_RANGES.hdr10 },
  audio: [
    {
      index: 0,
      codec: 'truehd',
      profile: 'Dolby TrueHD + Dolby Atmos',
      channels: 8,
      bitrate: null,
      sampleRate: 48_000,
    },
  ],
}

/** A 4K remux of an English Atmos track to sam's Windows PC. */
const remux = () =>
  liveStream({
    media: mediaItem({
      title: 'Croods',
      width: 3840,
      height: 2160,
      hdr: true,
      bitrate: 38_100_000,
      item: itemSummary({ type: 'movie', title: 'Croods', year: 2020 }),
    }),
    viewer: 'sam@example.com',
    device: 'Windows PC',
    browser: 'Chrome 155',
    mode: PLAYBACK_MODES.remux,
    audio: 0,
    sendRate: 42_600_000,
  })

describe('StreamsPage', () => {
  const spies = {
    list: spyOn(api, 'listLiveStreams'),
    stop: spyOn(api, 'stopStream'),
    tracks: spyOn(api, 'getTracks'),
    probe: spyOn(api, 'getStreams'),
  }

  // A stream's tracks stay unread unless a test serves them.
  beforeEach(() => spies.tracks.mockImplementation(() => new Promise(() => undefined)))

  afterEach(() => {
    cleanup()
    Object.values(spies).forEach((spy) => spy.mockReset())
  })

  it('shows what is streaming, to which device and browser, and how far along', async () => {
    spies.list.mockImplementation(async () => [
      liveStream({
        media: mediaItem({
          title: 'Busboys',
          duration: 3600,
          item: itemSummary({ type: 'movie', title: 'Busboys', year: 2026 }),
        }),
        libraryName: 'Films',
        browser: 'Safari 18',
        device: 'iPhone',
        address: '203.0.113.9',
        mode: PLAYBACK_MODES.transcode,
        position: 754,
      }),
    ])
    renderWithProviders({ ui: <StreamsPage /> })

    expect(await screen.findByRole('heading', { name: 'Busboys (2026)' })).toBeInTheDocument()
    expect(screen.getByText('1 stream')).toBeInTheDocument()
    expect(screen.getByText('Films')).toBeInTheDocument()
    expect(screen.getByText('iPhone, Safari 18')).toBeInTheDocument()
    const tags = screen.getByRole('list', { name: 'How it plays' })
    expect(within(tags).getByText('Transcoding')).toBeInTheDocument()
    expect(screen.getByText('12:34 of 1:00:00')).toBeInTheDocument()
  })

  it('names the account watching, and tags the picture, the sound and the rate', async () => {
    spies.list.mockImplementation(async () => [remux()])
    spies.tracks.mockImplementation(async () => TRACKS)
    renderWithProviders({ ui: <StreamsPage /> })

    expect(await screen.findByText('sam@example.com on Windows PC')).toBeInTheDocument()
    const tags = screen.getByRole('list', { name: 'How it plays' })
    expect(within(tags).getByText('4K')).toBeInTheDocument()
    expect(within(tags).getByText('HDR')).toBeInTheDocument()
    expect(await within(tags).findByText('English · AAC stereo')).toBeInTheDocument()
    expect(within(tags).getByText('42.6 Mb/s')).toBeInTheDocument()
    expect(within(tags).getByText('Remuxing')).toBeInTheDocument()
  })

  it('names the track as it is on direct play, and leaves out a rate not yet measured', async () => {
    spies.list.mockImplementation(async () => [
      liveStream({ mode: PLAYBACK_MODES.direct, audio: 1, sendRate: null }),
    ])
    spies.tracks.mockImplementation(async () => TRACKS)
    renderWithProviders({ ui: <StreamsPage /> })

    const tags = await screen.findByRole('list', { name: 'How it plays' })
    expect(await within(tags).findByText('Spanish · Dolby Digital · 5.1')).toBeInTheDocument()
    expect(within(tags).queryByText(/b\/s$/)).toBeNull()
  })

  it('starts closed, and opens to who is watching and the picture, sound and bandwidth', async () => {
    spies.list.mockImplementation(async () => [remux()])
    spies.tracks.mockImplementation(async () => TRACKS)
    spies.probe.mockImplementation(async () => PROBE)
    renderWithProviders({ ui: <StreamsPage /> })

    const toggle = await screen.findByRole('button', { name: 'Show the details of Croods (2020)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('heading', { name: 'Viewer' })).toBeNull()
    expect(spies.probe).not.toHaveBeenCalled()

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Hide the details of Croods (2020)')
    const viewer = screen.getByRole('heading', { name: 'Viewer' }).closest('section')
    expect(viewer).not.toBeNull()
    expect(within(viewer!).getByText('sam@example.com')).toBeInTheDocument()
    expect(within(viewer!).getByText('Windows PC · Chrome 155')).toBeInTheDocument()
    expect(within(viewer!).getByText('203.0.113.9')).toBeInTheDocument()
    const video = screen.getByRole('heading', { name: 'Video' }).closest('section')
    expect(await within(video!).findByText('HEVC Main 10')).toBeInTheDocument()
    expect(within(video!).getByText('4K · HDR10')).toBeInTheDocument()
    expect(within(video!).getByText('Copied as it is')).toBeInTheDocument()
    const audio = screen.getByRole('heading', { name: 'Audio' }).closest('section')
    expect(within(audio!).getByText('English')).toBeInTheDocument()
    expect(within(audio!).getByText('Dolby TrueHD + Dolby Atmos · 7.1')).toBeInTheDocument()
    expect(within(audio!).getByText('AAC stereo')).toBeInTheDocument()
    const bandwidth = screen.getByRole('heading', { name: 'Bandwidth' }).closest('section')
    expect(within(bandwidth!).getByText('42.6 Mb/s')).toBeInTheDocument()
    expect(within(bandwidth!).getByText('38.1 Mb/s')).toBeInTheDocument()
    expect(spies.probe).toHaveBeenCalledTimes(1)

    await userEvent.click(toggle)
    expect(screen.queryByRole('heading', { name: 'Viewer' })).toBeNull()
  })

  it('names the size a transcode was asked for, and says it is measuring before a rate', async () => {
    spies.list.mockImplementation(async () => [
      liveStream({ mode: PLAYBACK_MODES.transcode, quality: 'high720', sendRate: null }),
    ])
    spies.probe.mockImplementation(async () => PROBE)
    renderWithProviders({ ui: <StreamsPage /> })
    await userEvent.click(await screen.findByRole('button', { name: /^Show the details of / }))

    expect(screen.getByText('Converted to 720p HD (High)')).toBeInTheDocument()
    expect(screen.getByText('Measuring')).toBeInTheDocument()
  })

  it('says Starting until the player has reported a spot', async () => {
    spies.list.mockImplementation(async () => [liveStream({ position: null })])
    renderWithProviders({ ui: <StreamsPage /> })
    expect(await screen.findByText('Starting')).toBeInTheDocument()
  })

  it('says so when nobody is streaming', async () => {
    spies.list.mockImplementation(async () => [])
    renderWithProviders({ ui: <StreamsPage /> })
    expect(await screen.findByText('Nobody is streaming right now')).toBeInTheDocument()
  })

  it('stops a stream by its id and reads the list again', async () => {
    spies.list.mockImplementation(async () => [liveStream({ id: 'abc', device: 'Mac' })])
    spies.stop.mockImplementation(async () => undefined)
    renderWithProviders({ ui: <StreamsPage /> })
    const stop = await screen.findByRole('button', { name: /^Stop .* on Mac, Chrome 141$/ })

    spies.list.mockImplementation(async () => [])
    await userEvent.click(stop)

    expect(spies.stop).toHaveBeenCalledWith('abc')
    expect(await screen.findByText('Nobody is streaming right now')).toBeInTheDocument()
  })

  it('says why a stream could not be stopped, and keeps it listed', async () => {
    spies.list.mockImplementation(async () => [liveStream()])
    spies.stop.mockImplementation(async () => {
      throw new ApiError({ status: 404, message: 'That stream is not live any more' })
    })
    renderWithProviders({ ui: <StreamsPage /> })
    await userEvent.click(await screen.findByRole('button', { name: /^Stop / }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not stop it: That stream is not live any more',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /^Stop / })).toBeEnabled())
  })

  it('asks for nothing and points to Settings while the admin lock is on', () => {
    renderWithProviders({ ui: <StreamsPage />, adminLock: { state: 'on', available: true } })
    expect(screen.getByRole('heading', { name: 'Streams are for the admin' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('lists the streams for the owner of a server with accounts', async () => {
    spies.list.mockImplementation(async () => [liveStream({ device: 'Mac' })])
    renderWithProviders({
      ui: <StreamsPage />,
      account: fakeAccount({ isOwner: true }),
      adminLock: null,
    })
    expect(await screen.findByText('Mac, Chrome 141')).toBeInTheDocument()
  })

  it('says streams are for the owner to a member, and asks for nothing', () => {
    renderWithProviders({ ui: <StreamsPage />, account: fakeAccount(), adminLock: null })
    expect(screen.getByRole('heading', { name: 'Streams are for the owner' })).toBeInTheDocument()
    expect(screen.queryByText(/admin lock/i)).toBeNull()
    expect(spies.list).not.toHaveBeenCalled()
  })

  it('says when the server did not answer', async () => {
    spies.list.mockImplementation(async () => {
      throw new ApiError({ status: 500, message: 'Boom' })
    })
    renderWithProviders({ ui: <StreamsPage /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer: Boom')
  })
})
