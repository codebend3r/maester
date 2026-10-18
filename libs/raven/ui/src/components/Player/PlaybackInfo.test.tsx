import { afterEach, describe, expect, it, jest, mock, spyOn } from 'bun:test'
import {
  type MediaItem,
  type MediaStreams,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackMode,
} from '@raven/core'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EngineStats } from '@/components/Player/engine'
import type { StepDown } from '@/components/Player/usePlaybackLadder'
import { PlaybackInfo } from '@/components/Player/PlaybackInfo'
import { api } from '@/test/api'
import { mediaItem } from '@/test/fixtures'
import { DEFAULT_PLAYBACK_STATE, renderWithProviders } from '@/test/render'

const TRACKS: MediaTracks = {
  audio: [
    { index: 0, codec: 'dts', channels: 6, language: 'en', title: null, default: true },
    { index: 1, codec: 'aac', channels: 2, language: 'ja', title: 'Commentary', default: false },
  ],
  subtitles: [],
  defaultAudio: 0,
  frameRate: 24_000 / 1001,
}

const STREAMS: MediaStreams = {
  video: { codec: 'hevc', profile: 'Main 10', bitrate: 11_100_000, range: 'hdr10' },
  audio: [
    {
      index: 0,
      codec: 'dts',
      profile: 'DTS-HD MA',
      channels: 6,
      bitrate: 1_509_000,
      sampleRate: 48_000,
    },
    { index: 1, codec: 'aac', profile: 'LC', channels: 2, bitrate: 192_000, sampleRate: 44_100 },
  ],
}

const STILL: EngineStats = { engine: 'HTML video', viewport: null, frame: null, frames: null }

const spies: Array<{ mockRestore: () => void }> = []
const stubStreams = (answer: () => Promise<MediaStreams>) => {
  const spy = spyOn(api, 'getStreams').mockImplementation(answer)
  spies.push(spy)
  return spy
}

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

const renderInfo = ({
  mode = 'direct',
  media = null,
  audio = 0,
  readStats = () => STILL,
  onClose = () => {},
  playback = DEFAULT_PLAYBACK_STATE,
  steppedDown = null,
}: {
  mode?: PlaybackMode
  steppedDown?: StepDown | null
  media?: MediaItem | null
  audio?: number | null
  readStats?: () => EngineStats
  onClose?: () => void
  playback?: typeof DEFAULT_PLAYBACK_STATE | null
}) =>
  renderWithProviders({
    ui: (
      <PlaybackInfo
        readStats={readStats}
        mode={mode}
        steppedDown={steppedDown}
        file={media && { media, api }}
        tracks={TRACKS}
        audio={audio}
        onClose={onClose}
      />
    ),
    playback,
  })

const section = (title: string): HTMLElement => {
  const found = screen.getByRole('heading', { name: title }).closest('section')
  if (!(found instanceof HTMLElement)) throw new Error(`No ${title} section`)
  return found
}

/** The value beside a term, in the one section that has it. */
const valueOf = ({ title, term }: { title: string; term: string }): string | null =>
  within(section(title)).queryByText(term)?.nextElementSibling?.textContent ?? null

describe('PlaybackInfo', () => {
  it('says when the connection put the picture on a transcode', () => {
    renderInfo({
      mode: PLAYBACK_MODES.transcode,
      steppedDown: {
        from: PLAYBACK_MODES.remux,
        delivery: { delivered: 39_200_000, needed: 69_800_000 },
      },
    })
    expect(
      screen.getByText(
        'Switched to a transcode because the connection carried 39.2 Mb/s and the remux needs 69.8 Mb/s.',
      ),
    ).toBeTruthy()
  })

  it('gives no reason for a transcode the connection did not cause', () => {
    renderInfo({ mode: PLAYBACK_MODES.transcode })
    expect(screen.queryByText(/Switched to a transcode/)).toBeNull()
  })

  it('shows the live figures and reads them again each second', async () => {
    jest.useFakeTimers()
    try {
      const frames = { dropped: 0, total: 240 }
      const readStats = mock((): EngineStats => ({
        engine: 'HTML video',
        viewport: { width: 1280, height: 720, scale: 2 },
        frame: { width: 1920, height: 800 },
        frames: { ...frames },
      }))
      const onClose = mock(() => {})
      renderInfo({ readStats, onClose })
      expect(screen.getByRole('dialog', { name: 'Playback info' })).toBeInTheDocument()
      expect(valueOf({ title: 'Playback', term: 'Player' })).toBe('HTML video')
      expect(valueOf({ title: 'Playback', term: 'Method' })).toBe('Direct play')
      expect(valueOf({ title: 'Playback', term: 'Delivery' })).toBe('The file as it is')
      expect(valueOf({ title: 'Video', term: 'Player size' })).toBe('1280×720 at 2×')
      expect(valueOf({ title: 'Video', term: 'Decoded size' })).toBe('1920×800')
      expect(valueOf({ title: 'Video', term: 'Dropped frames' })).toBe('0 of 240')
      frames.dropped = 3
      frames.total = 480
      act(() => jest.advanceTimersByTime(1000))
      expect(valueOf({ title: 'Video', term: 'Dropped frames' })).toBe('3 of 480')
      // A local file has no library file to describe.
      expect(screen.queryByRole('heading', { name: 'Original file' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Conversion' })).toBeNull()
      jest.useRealTimers()
      await userEvent.click(screen.getByRole('button', { name: 'Close playback info' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('leaves out what the engine cannot tell, and drops the scale on a plain screen', () => {
    renderInfo({
      readStats: () => ({ ...STILL, viewport: { width: 800, height: 450, scale: 1 } }),
    })
    expect(valueOf({ title: 'Video', term: 'Player size' })).toBe('800×450')
    expect(within(section('Video')).queryByText('Decoded size')).toBeNull()
    expect(within(section('Video')).queryByText('Dropped frames')).toBeNull()
  })

  it("describes the original file, filling in the probe's detail once it is read", async () => {
    const streams = Promise.withResolvers<MediaStreams>()
    const getStreams = stubStreams(() => streams.promise)
    renderInfo({ media: mediaItem() })
    const original = { title: 'Original file' }
    expect(getStreams).toHaveBeenCalledWith(7)
    expect(within(section('Original file')).getByText("Reading the file's streams")).toBeTruthy()
    expect(valueOf({ ...original, term: 'Container' })).toBe('MKV')
    expect(valueOf({ ...original, term: 'Size' })).toBe('1.6 GB')
    expect(valueOf({ ...original, term: 'Bitrate' })).toBe('2.2 Mb/s')
    expect(valueOf({ ...original, term: 'Video codec' })).toBe('HEVC')
    expect(valueOf({ ...original, term: 'Bit depth' })).toBe('10-bit')
    expect(valueOf({ ...original, term: 'Resolution' })).toBe('1920×1038 (1080p)')
    expect(valueOf({ ...original, term: 'Frame rate' })).toBe('23.976 fps')
    expect(valueOf({ ...original, term: 'Range' })).toBe('SDR')
    expect(valueOf({ ...original, term: 'Audio track' })).toBe('English')
    expect(valueOf({ ...original, term: 'Audio codec' })).toBe('DTS')
    expect(valueOf({ ...original, term: 'Channels' })).toBe('5.1')
    expect(valueOf({ ...original, term: 'Video bitrate' })).toBeNull()
    streams.resolve(STREAMS)
    expect(await within(section('Original file')).findByText('HEVC Main 10')).toBeTruthy()
    expect(within(section('Original file')).queryByText("Reading the file's streams")).toBeNull()
    expect(valueOf({ ...original, term: 'Video bitrate' })).toBe('11.1 Mb/s')
    expect(valueOf({ ...original, term: 'Range' })).toBe('HDR10')
    // The profile names the codec already, so it stands alone.
    expect(valueOf({ ...original, term: 'Audio codec' })).toBe('DTS-HD MA')
    expect(valueOf({ ...original, term: 'Audio bitrate' })).toBe('1.5 Mb/s')
    expect(valueOf({ ...original, term: 'Sample rate' })).toBe('48 kHz')
  })

  it('follows the audio track playing', async () => {
    stubStreams(async () => STREAMS)
    renderInfo({ media: mediaItem(), audio: 1 })
    const original = { title: 'Original file' }
    expect(await within(section('Original file')).findByText('AAC LC')).toBeTruthy()
    expect(valueOf({ ...original, term: 'Audio track' })).toBe('Japanese')
    expect(valueOf({ ...original, term: 'Channels' })).toBe('Stereo')
    expect(valueOf({ ...original, term: 'Sample rate' })).toBe('44.1 kHz')
  })

  it('says when the probe fails, and keeps to what the index knows', async () => {
    stubStreams(async () => {
      throw new Error('ffprobe timed out')
    })
    renderInfo({
      media: mediaItem({ videoCodec: null, width: null, height: null, hdr: true }),
      audio: null,
    })
    expect(
      await within(section('Original file')).findByText("The file's streams could not be read."),
    ).toBeTruthy()
    const original = { title: 'Original file' }
    expect(valueOf({ ...original, term: 'Video codec' })).toBeNull()
    expect(valueOf({ ...original, term: 'Resolution' })).toBeNull()
    expect(valueOf({ ...original, term: 'Range' })).toBeNull()
    expect(valueOf({ ...original, term: 'Audio track' })).toBeNull()
    expect(valueOf({ ...original, term: 'Audio codec' })).toBe('AAC')
  })

  it('names HDR from the index until the probe says which', () => {
    stubStreams(() => new Promise(() => {}))
    renderInfo({ media: mediaItem({ hdr: true }) })
    expect(valueOf({ title: 'Original file', term: 'Range' })).toBe('HDR')
  })

  it('says what a transcode is made of, by the playback settings', () => {
    stubStreams(() => new Promise(() => {}))
    renderInfo({ mode: 'transcode', media: mediaItem() })
    expect(valueOf({ title: 'Playback', term: 'Method' })).toBe('Transcode')
    expect(valueOf({ title: 'Playback', term: 'Delivery' })).toBe('Fragmented MP4 through MSE')
    expect(valueOf({ title: 'Conversion', term: 'Video codec' })).toBe(
      'H.264, re-encoded up to 1080p at medium quality',
    )
    expect(valueOf({ title: 'Conversion', term: 'Audio codec' })).toBe('AAC stereo, re-encoded')
  })

  it('names a 4K ceiling as 4K, and says less without the settings', () => {
    stubStreams(() => new Promise(() => {}))
    const fourK = {
      ...DEFAULT_PLAYBACK_STATE,
      settings: { ...DEFAULT_PLAYBACK_STATE.settings, maxHeight: 2160, quality: 'high' },
    } as const satisfies typeof DEFAULT_PLAYBACK_STATE
    const { unmount } = renderInfo({ mode: 'transcode', media: mediaItem(), playback: fourK })
    expect(valueOf({ title: 'Conversion', term: 'Video codec' })).toBe(
      'H.264, re-encoded up to 4K at high quality',
    )
    unmount()
    spies.push(spyOn(api, 'getPlaybackSettings').mockImplementation(() => new Promise(() => {})))
    renderInfo({ mode: 'transcode', media: mediaItem(), playback: null })
    expect(valueOf({ title: 'Conversion', term: 'Video codec' })).toBe('H.264, re-encoded')
  })

  it('says a remux copies the video and converts the sound', () => {
    stubStreams(() => new Promise(() => {}))
    const { unmount } = renderInfo({ mode: 'remux', media: mediaItem() })
    expect(valueOf({ title: 'Playback', term: 'Method' })).toBe('Remux')
    expect(valueOf({ title: 'Conversion', term: 'Video codec' })).toBe('HEVC, copied as it is')
    unmount()
    renderInfo({ mode: 'remux', media: mediaItem({ audioCodec: null }) })
    expect(within(section('Conversion')).queryByText('Audio codec')).toBeNull()
  })
})
