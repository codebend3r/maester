import { type AudioQuality, DOWNLOAD_STATUS_KINDS, LIBRARY_KINDS, type Track } from '@raven/core'
import { MUSIC_QUALITIES, usePlayerPrefs } from '@raven/ui/headless'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, screen } from '@testing-library/react'
import type { AudioConnection } from '@/desktop/audioConnection'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'
import { playedQualityOf, useAudioQuality } from '@/lib/useAudioQuality'
import { DL_2, asPlayingDesktop, audioConnectionsOf, downloadsMain, viewOf } from '@/test/desktop'
import { library } from '@/test/fixtures'
import { track } from '@/test/music'
import { renderWithProviders } from '@/test/render'

const TRACK = track()

const FILE: AudioQuality = {
  format: 'FLAC',
  bitDepth: '16-bit',
  sampleRate: '44.1 kHz',
  bitrate: '900 kbps',
  isDownloaded: false,
}

const TRANSCODE: AudioQuality = {
  format: 'AAC',
  bitDepth: null,
  sampleRate: null,
  bitrate: '256 kbps',
  isDownloaded: false,
}

const DOWNLOAD: AudioQuality = { ...FILE, isDownloaded: true }

const BROWSER = {
  track: TRACK,
  engine: null,
  streamed: FILE,
  hasDownload: false,
} as const

describe('playedQualityOf', () => {
  it('is the file in a browser that asks for no transcode', () => {
    expect(playedQualityOf(BROWSER)).toEqual(FILE)
  })

  it('is the transcode at the bitrate the browser asks for', () => {
    expect(playedQualityOf({ ...BROWSER, streamed: TRANSCODE })).toEqual(TRANSCODE)
  })

  it('is nothing while the libraries are read, which the host waits out', () => {
    expect(playedQualityOf({ ...BROWSER, streamed: null })).toBeNull()
  })

  it('is nothing while Raven has not said which engine plays', () => {
    expect(playedQualityOf({ ...BROWSER, engine: CONNECTION_STATUSES.waiting })).toBeNull()
  })

  it("is the downloaded file in Raven's engine, whatever is streamed and with no libraries read", () => {
    const downloaded = { ...BROWSER, engine: CONNECTION_STATUSES.native, hasDownload: true }
    expect(playedQualityOf({ ...downloaded, streamed: TRANSCODE })).toEqual(DOWNLOAD)
    expect(playedQualityOf({ ...downloaded, streamed: null })).toEqual(DOWNLOAD)
  })

  it("is the server's file or transcode in Raven's engine with no download", () => {
    const native = { ...BROWSER, engine: CONNECTION_STATUSES.native }
    expect(playedQualityOf(native)).toEqual(FILE)
    expect(playedQualityOf({ ...native, streamed: TRANSCODE })).toEqual(TRANSCODE)
  })

  it.each([CONNECTION_STATUSES.unavailable, CONNECTION_STATUSES.lost])(
    "never plays a download through the page's own host, the engine %s",
    (engine) => {
      expect(
        playedQualityOf({ ...BROWSER, engine, streamed: TRANSCODE, hasDownload: true }),
      ).toEqual(TRANSCODE)
    },
  )
})

const MUSIC = library({
  id: TRACK.libraryId,
  name: 'Music',
  settings: { ...library().settings, kind: LIBRARY_KINDS.music },
})

const NO_PLAYER = { send: async () => {}, subscribe: () => () => {} }

const NATIVE: AudioConnection = { status: CONNECTION_STATUSES.native, player: NO_PLAYER }

const LOST: AudioConnection = { status: CONNECTION_STATUSES.lost, message: 'Gone.' }

/** A ready download of `of`, as main lists it for the server in use. */
const readyTrack = (of: Track) =>
  viewOf({ status: { kind: DOWNLOAD_STATUS_KINDS.ready }, track: of })

const NOTHING = 'nothing'

type ProbeProps = { track: Track }

const Probe = ({ track: playing }: ProbeProps) => {
  const quality = useAudioQuality({ track: playing })
  return <output>{quality === null ? NOTHING : JSON.stringify(quality)}</output>
}

const said = (quality: AudioQuality) => screen.findByText(JSON.stringify(quality))

afterEach(() => {
  cleanup()
  usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.original)
})

describe('useAudioQuality', () => {
  it('is nothing in a browser until the libraries are read', () => {
    renderWithProviders({ ui: <Probe track={TRACK} /> })
    expect(screen.getByText(NOTHING)).toBeTruthy()
  })

  it("follows the browser host's bitrate: the file, then the transcode the prefs pick", async () => {
    renderWithProviders({ ui: <Probe track={TRACK} />, libraries: [MUSIC] })
    expect(await said(FILE)).toBeTruthy()
    cleanup()
    usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.standard)
    renderWithProviders({ ui: <Probe track={TRACK} />, libraries: [MUSIC] })
    expect(await said(TRANSCODE)).toBeTruthy()
  })

  it("says Raven's engine plays the track's ready download, not the transcode asked for", async () => {
    usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.standard)
    asPlayingDesktop({
      client: downloadsMain({ downloads: [readyTrack(TRACK)] }),
      audio: audioConnectionsOf(NATIVE),
    })
    renderWithProviders({ ui: <Probe track={TRACK} />, libraries: [MUSIC] })
    expect(await said(DOWNLOAD)).toBeTruthy()
  })

  it('counts neither a download still on its way nor another track', async () => {
    usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.standard)
    const client = downloadsMain({
      downloads: [
        viewOf({ track: TRACK }),
        { ...readyTrack(track({ id: 102 })), downloadId: DL_2 },
      ],
    })
    asPlayingDesktop({ client, audio: audioConnectionsOf(NATIVE) })
    renderWithProviders({ ui: <Probe track={TRACK} />, libraries: [MUSIC] })
    expect(await said(TRANSCODE)).toBeTruthy()
    expect(client.request).toHaveBeenCalled()
  })

  it("leaves the downloads unasked once the engine is lost and the page's host plays", async () => {
    usePlayerPrefs.getState().setMusicQuality(MUSIC_QUALITIES.standard)
    const client = downloadsMain({ downloads: [readyTrack(TRACK)] })
    asPlayingDesktop({ client, audio: audioConnectionsOf(LOST) })
    renderWithProviders({ ui: <Probe track={TRACK} />, libraries: [MUSIC] })
    expect(await said(TRANSCODE)).toBeTruthy()
    expect(client.request).not.toHaveBeenCalled()
  })

  it("is nothing while Raven's answer about its engine is on its way", () => {
    asPlayingDesktop({ audio: audioConnectionsOf({ status: CONNECTION_STATUSES.waiting }) })
    renderWithProviders({ ui: <Probe track={TRACK} />, libraries: [MUSIC] })
    expect(screen.getByText(NOTHING)).toBeTruthy()
  })
})
