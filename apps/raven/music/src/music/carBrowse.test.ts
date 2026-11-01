import { beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  AUDIO_PLAYER_EVENTS,
  BROWSE_ROOTS,
  type BrowseAnswer,
  type BrowseNode,
} from '@raven/audio/contract'
import {
  ALBUM_TYPES,
  AUDIO_BITRATES,
  AUDIO_CODECS,
  type AlbumDetails,
  type AlbumSummary,
  MATCH_STATES,
  QUEUE_SOURCE_KINDS,
  type Track,
} from '@raven/core'
import type { BrowseApi } from '@raven/native/headless'
import { useAudioQueue } from '@raven/ui/headless'

import { DOWNLOAD_STATUSES, downloadKeyOf, useDownloads } from '@/downloads/downloadStore'
import { carBrowseFor } from '@/music/carBrowse'

const SERVER_ID = 'raven'

const SERVER_HEADERS = { cookie: 'raven_unlock=1', authorization: 'Bearer access' }

const albumFor = (id: number): AlbumSummary => ({
  id,
  libraryId: 5,
  title: `Album ${id}`,
  sortTitle: `Album ${id}`,
  year: 2026,
  releaseDate: null,
  type: ALBUM_TYPES.album,
  artists: [{ id: 1, name: 'The Fixture Birds' }],
  isCompilation: false,
  trackCount: 2,
  duration: 40,
  coverVersion: 'v1',
  match: MATCH_STATES.matched,
  addedAt: '2026-10-01T00:00:00Z',
})

type TrackForProps = { id: number; albumId: number; number: number }

const trackFor = ({ id, albumId, number }: TrackForProps): Track => ({
  id,
  libraryId: 5,
  albumId,
  title: `Track ${id}`,
  disc: 1,
  number,
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
  album: { title: `Album ${albumId}`, coverVersion: 'v1' },
})

const ALBUM_3_TRACKS = [
  trackFor({ id: 31, albumId: 3, number: 1 }),
  trackFor({ id: 32, albumId: 3, number: 2 }),
]

const DOWNLOADED_ALBUM = albumFor(8)
const DOWNLOADED_TRACK = trackFor({ id: 81, albumId: DOWNLOADED_ALBUM.id, number: 1 })

const failing = (): Promise<never> => Promise.reject(new Error('server unreachable'))

const onlineApi: BrowseApi = {
  listLibraries: failing,
  listAlbums: failing,
  listPlaylists: () => Promise.resolve([]),
  getAlbum: (id: number): Promise<AlbumDetails> =>
    Promise.resolve({
      album: albumFor(id),
      label: null,
      genres: [],
      mbid: null,
      discCount: 1,
      tracks: ALBUM_3_TRACKS,
      isFavourite: false,
    }),
  getPlaylist: failing,
  albumCoverUrl: ({ albumId }) => `https://raven.example/api/pictures/albums/${albumId}/v1`,
}

const unreachableApi: BrowseApi = {
  ...onlineApi,
  listPlaylists: failing,
  getAlbum: failing,
}

type CarOverProps = { api: BrowseApi }

const carOver = ({ api }: CarOverProps) => {
  const answers: BrowseAnswer[] = []
  const car = carBrowseFor({
    api,
    serverId: SERVER_ID,
    uriOf: (path) => `file:///documents/${path}`,
    headersFor: async () => SERVER_HEADERS,
    answer: async (answered) => {
      answers.push(answered)
    },
  })
  return { car, answers }
}

/** Lets the car's answer, made from promises, land. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

const DOWNLOADED_NODE: BrowseNode = {
  id: `album:${DOWNLOADED_ALBUM.id}`,
  title: DOWNLOADED_ALBUM.title,
  subtitle: 'The Fixture Birds',
  artworkUri: null,
  isPlayable: true,
}

describe('carBrowseFor', () => {
  beforeEach(() => {
    useAudioQueue.getState().playTracks({ tracks: [] })
    useDownloads.setState({
      entries: {
        [downloadKeyOf({ serverId: SERVER_ID, id: DOWNLOADED_TRACK.id })]: {
          mediaId: DOWNLOADED_TRACK.id,
          serverId: SERVER_ID,
          kbps: AUDIO_BITRATES.standard,
          bytes: 640_000,
          path: `downloads/${SERVER_ID}/${DOWNLOADED_TRACK.id}/media.m4a`,
          coverPath: null,
          track: DOWNLOADED_TRACK,
          album: DOWNLOADED_ALBUM,
          status: DOWNLOAD_STATUSES.done,
          queueStamp: 1,
        },
      },
      playlists: {},
    })
  })

  it('answers a browse request under its own id', async () => {
    const { car, answers } = carOver({ api: onlineApi })
    car.browse({ type: AUDIO_PLAYER_EVENTS.browse, requestId: 'r7', parentId: BROWSE_ROOTS.home })
    await settled()
    expect(answers.map(({ requestId }) => requestId)).toEqual(['r7'])
    expect(answers[0]?.nodes.map(({ id }) => id)).toEqual([
      BROWSE_ROOTS.albums,
      BROWSE_ROOTS.playlists,
      BROWSE_ROOTS.downloads,
    ])
    expect(answers[0]?.artworkHeaders).toEqual({})
  })

  it("sends the server's headers for its covers", async () => {
    const { car, answers } = carOver({ api: onlineApi })
    car.browse({
      type: AUDIO_PLAYER_EVENTS.browse,
      requestId: 'r8',
      parentId: BROWSE_ROOTS.downloads,
    })
    await settled()
    expect(answers[0]?.nodes).toEqual([
      { ...DOWNLOADED_NODE, artworkUri: 'https://raven.example/api/pictures/albums/8/v1' },
    ])
    expect(answers[0]?.artworkHeaders).toEqual(SERVER_HEADERS)
  })

  it('answers from what is downloaded when the server fails', async () => {
    const { car, answers } = carOver({ api: unreachableApi })
    car.browse({ type: AUDIO_PLAYER_EVENTS.browse, requestId: 'r9', parentId: BROWSE_ROOTS.albums })
    await settled()
    expect(answers).toEqual([{ requestId: 'r9', nodes: [DOWNLOADED_NODE], artworkHeaders: {} }])
  })

  it("plays album 3's tracks when the car picks it", async () => {
    const playTracks = mock(useAudioQueue.getState().playTracks)
    useAudioQueue.setState({ playTracks })
    const { car } = carOver({ api: onlineApi })
    car.play({ type: AUDIO_PLAYER_EVENTS.playFromBrowse, id: 'album:3' })
    await settled()
    expect(playTracks).toHaveBeenCalledWith({
      tracks: ALBUM_3_TRACKS,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: 3 },
    })
  })

  it('plays a downloaded album from the device when the server fails', async () => {
    const { car } = carOver({ api: unreachableApi })
    car.play({ type: AUDIO_PLAYER_EVENTS.playFromBrowse, id: `album:${DOWNLOADED_ALBUM.id}` })
    await settled()
    expect(Object.values(useAudioQueue.getState().tracks)).toEqual([DOWNLOADED_TRACK])
  })
})
