import { beforeEach, describe, expect, it } from 'bun:test'
import { AUDIO_BITRATES, AUDIO_CODECS, type Track } from '@raven/core'
import { TRACK_STREAM_KINDS } from '@raven/native/headless'
import {
  DOWNLOAD_STATUSES,
  type DownloadEntry,
  downloadKeyOf,
  useDownloads,
} from '@/downloads/downloadStore'
import { trackPlanFor } from '@/music/trackPlan'
import { usePlayedStreams } from '@/stores/playedStreams'
import { DEFAULT_WREN_PREFS, useWrenPrefs } from '@/stores/wrenPrefs'

const SERVER_ID = 'raven'

const FIRST_LIGHT: Track = {
  id: 31,
  libraryId: 5,
  albumId: 7,
  title: 'First Light',
  disc: 1,
  number: 1,
  duration: 20,
  artists: [{ id: 1, name: 'The Fixture Birds' }],
  container: 'flac',
  codec: AUDIO_CODECS.flac,
  bitrate: 900_000,
  sampleRate: 44_100,
  bitDepth: 16,
  isLossless: true,
  mbid: null,
  addedAt: '2026-10-01T00:00:00Z',
  album: { title: 'Morning Chorus', coverVersion: null },
  gain: { track: null, album: null, trackPeak: null, albumPeak: null },
}

const ENTRY: DownloadEntry = {
  mediaId: FIRST_LIGHT.id,
  serverId: SERVER_ID,
  kbps: AUDIO_BITRATES.standard,
  bytes: 640_000,
  path: `downloads/${SERVER_ID}/${FIRST_LIGHT.id}/media.m4a`,
  coverPath: `downloads/${SERVER_ID}/${FIRST_LIGHT.id}/cover.jpg`,
  track: FIRST_LIGHT,
  album: null,
  status: DOWNLOAD_STATUSES.done,
  queueStamp: 1,
}

const KEY = downloadKeyOf({ serverId: SERVER_ID, id: FIRST_LIGHT.id })

type PlanOnProps = { isCellular: boolean }

const planOn = ({ isCellular }: PlanOnProps) =>
  trackPlanFor({
    serverId: SERVER_ID,
    isOnCellular: async () => isCellular,
    uriOf: (path) => `file:///documents/${path}`,
  })

describe('trackPlanFor', () => {
  beforeEach(() => {
    useWrenPrefs.setState(DEFAULT_WREN_PREFS)
    useDownloads.setState({ entries: {}, playlists: {} })
  })

  it("plays a finished download of this server's from its file", () => {
    useDownloads.setState({ entries: { [KEY]: ENTRY } })
    expect(planOn({ isCellular: false }).downloadedOf(FIRST_LIGHT)).toEqual({
      uri: `file:///documents/downloads/${SERVER_ID}/${FIRST_LIGHT.id}/media.m4a`,
      artworkUri: `file:///documents/downloads/${SERVER_ID}/${FIRST_LIGHT.id}/cover.jpg`,
      kbps: ENTRY.kbps,
    })
  })

  it("plays no download still on its way, or another server's", () => {
    useDownloads.setState({
      entries: { [KEY]: { ...ENTRY, status: DOWNLOAD_STATUSES.downloading } },
    })
    expect(planOn({ isCellular: false }).downloadedOf(FIRST_LIGHT)).toBeNull()
    const elsewhere = { ...ENTRY, serverId: 'elsewhere' }
    useDownloads.setState({
      entries: { [downloadKeyOf({ serverId: 'elsewhere', id: FIRST_LIGHT.id })]: elsewhere },
    })
    expect(planOn({ isCellular: false }).downloadedOf(FIRST_LIGHT)).toBeNull()
  })

  it('streams the file on a mobile network unless a cellular quality is chosen, and the file on Wi-Fi', async () => {
    expect(await planOn({ isCellular: true }).streamKbps()).toBeNull()
    useWrenPrefs.setState({ cellularKbps: AUDIO_BITRATES.standard })
    expect(await planOn({ isCellular: true }).streamKbps()).toBe(AUDIO_BITRATES.standard)
    useWrenPrefs.setState({ cellularKbps: AUDIO_BITRATES.low })
    expect(await planOn({ isCellular: false }).streamKbps()).toBeNull()
  })

  it('keeps what each track plays from, a download with the bitrate it was made at', () => {
    usePlayedStreams.setState({ streams: {} })
    useDownloads.setState({ entries: { [KEY]: ENTRY } })
    const plan = planOn({ isCellular: false })
    const downloaded = plan.downloadedOf(FIRST_LIGHT)
    plan.onStream?.({
      track: FIRST_LIGHT,
      stream: { kind: TRACK_STREAM_KINDS.download, kbps: downloaded?.kbps ?? null },
    })
    expect(usePlayedStreams.getState().streams[FIRST_LIGHT.id]).toEqual({
      kind: TRACK_STREAM_KINDS.download,
      kbps: ENTRY.kbps,
    })
    plan.onStream?.({ track: FIRST_LIGHT, stream: { kind: TRACK_STREAM_KINDS.file } })
    expect(usePlayedStreams.getState().streams[FIRST_LIGHT.id]).toEqual({
      kind: TRACK_STREAM_KINDS.file,
    })
  })
})
