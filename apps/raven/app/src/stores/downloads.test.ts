import { beforeEach, describe, expect, it } from 'bun:test'
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  CONTAINERS,
  DEVICE_DOWNLOAD_STATES,
  type DeviceDownload,
  type MediaTracks,
  PLAYBACK_MODES,
  type Track,
  isRecord,
} from '@raven/core'
import { type DownloadDisk, type SourceRequest, folderOf } from '@raven/native/headless'
import { type StateStorage, createJSONStorage } from 'zustand/middleware'
import { mediaItemFor } from '@raven/native/testing'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import {
  DOWNLOAD_KINDS,
  DOWNLOAD_STATES,
  DOWNLOAD_WAYS,
  type DownloadGroup,
  type DownloadStatus,
  GROUP_KINDS,
  type TrackRequest,
  type VideoRequest,
  groupKeyOf,
} from '@/downloads/downloadEntries'
import type { DownloadServer } from '@/downloads/downloadRun'
import {
  ALBUM_GROUP,
  DOWNLOADS_SERVER_ID,
  SEASON_GROUP,
  downloadKeyFor,
} from '@/test/downloadFixtures'
import { AIRBAG, PARANOID } from '@/test/musicServer'
import { useDownloadProgress } from '@/stores/downloadProgress'
import { DOWNLOADS_KEY, configureDownloads, useDownloads } from '@/stores/downloads'

const ORIGIN = 'http://nas:8484'

const MOVIE = mediaItemFor({ id: 11, title: 'Busboys', container: CONTAINERS.mp4 })

const MKV = mediaItemFor({ id: 12, title: 'Pilot', container: CONTAINERS.mkv })

const SECOND = mediaItemFor({ id: 13, title: 'Second', container: CONTAINERS.mp4 })

const THIRD = mediaItemFor({ id: 14, title: 'Third', container: CONTAINERS.mp4 })

const MOVIE_GROUP: DownloadGroup = {
  kind: GROUP_KINDS.movie,
  id: 1,
  title: 'Busboys',
  season: null,
  library: null,
}

const POSTER = `${ORIGIN}/api/pictures/poster`

const LOGO = `${ORIGIN}/api/pictures/logo`

/** The title art the server names for a download asked for before entries kept it. */
const TITLE_ART = `${ORIGIN}/api/pictures/title-art`

const TRACKS: MediaTracks = { audio: [], subtitles: [], defaultAudio: null, frameRate: null }

type VideoOfProps = { media: typeof MOVIE; way?: VideoRequest['way'] }

const videoOf = ({ media, way = DOWNLOAD_WAYS.file }: VideoOfProps): VideoRequest => ({
  kind: DOWNLOAD_KINDS.video,
  media,
  way,
  title: media.title,
  line: '2026',
  order: media.id,
})

const trackOf = (track: Track): TrackRequest => ({
  kind: DOWNLOAD_KINDS.track,
  track,
  title: track.title,
  line: 'Radiohead',
  order: track.number ?? 0,
})

const statusOf = (mediaId: number): DownloadStatus | undefined =>
  useDownloads.getState().entries[downloadKeyFor(mediaId)]?.status

type Gate = { open: () => void; promise: Promise<void> }

const gateOf = (): Gate => {
  let open = (): void => undefined
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, promise }
}

/** A disk in memory: each fetch writes `bytes` (or the picture's 10), waiting first on its address's gate when it has one. */
const memoryDisk = () => {
  let files: ReadonlyMap<string, number> = new Map()
  let gates: ReadonlyMap<string, Gate> = new Map()
  let fetched: readonly string[] = []
  const disk: DownloadDisk = {
    fetch: async ({ source, path, signal, onProgress }) => {
      fetched = [...fetched, source.uri]
      if (onProgress !== null) onProgress({ bytes: 50, total: 100 })
      const aborted = new Promise<void>((resolve) => {
        if (signal !== null) signal.addEventListener('abort', () => resolve())
      })
      await Promise.race([gates.get(source.uri)?.promise, aborted])
      if (!!signal?.aborted) throw new Error('aborted')
      if (source.uri.includes('broken')) throw new Error('cut')
      const bytes = source.uri === POSTER ? 10 : 100
      files = new Map([...files, [path, bytes]])
      return bytes
    },
    uriOf: (path) => `file:///documents/${path}`,
    exists: (path) => files.has(path),
    folders: () => [
      ...new Set([...files.keys()].map((path) => path.split('/').slice(0, 3).join('/'))),
    ],
    remove: async (folder) => {
      files = new Map([...files].filter(([path]) => !path.startsWith(`${folder}/`)))
    },
    removeAll: async () => {
      files = new Map()
    },
    freeBytes: () => 123_400_000_000,
  }
  return {
    disk,
    files: () => files,
    fetched: () => fetched,
    put: (path: string) => {
      files = new Map([...files, [path, 100]])
    },
    gate: (uri: string): Gate => {
      const gate = gateOf()
      gates = new Map([...gates, [uri, gate]])
      return gate
    },
  }
}

const uriFor = (request: SourceRequest) => `${ORIGIN}/api/media/${request.media.id}/file?t=ticket`

/** A server whose copies answer `answers` in turn, and whose sources name what they were asked for. */
type ServerWithProps = { answers?: readonly DeviceDownload[] }

const serverWith = ({ answers = [] }: ServerWithProps = {}) => {
  let left = answers
  let trackAsks: readonly (number | null)[] = []
  const server: DownloadServer = {
    sources: {
      source: async (request) => ({ ok: true, source: { uri: uriFor(request), headers: {} } }),
      trackSource: async ({ mediaId, kbps }) => {
        trackAsks = [...trackAsks, kbps]
        return { ok: true, source: { uri: `${ORIGIN}/api/media/${mediaId}/track`, headers: {} } }
      },
      copySource: async (mediaId) => ({
        ok: true,
        source: {
          uri: `${ORIGIN}/api/media/${mediaId}/device-download/file?t=ticket`,
          headers: {},
        },
      }),
    },
    prepare: async () => {
      const [next, ...rest] = left
      left = rest
      return next ?? { state: DEVICE_DOWNLOAD_STATES.ready, bytes: 100 }
    },
    tracks: async () => TRACKS,
    pictureHeaders: async () => ({}),
    titleArtOf: async () => TITLE_ART,
  }
  return { server, trackAsks: () => trackAsks }
}

type MemoryStorage = StateStorage & { read: () => string | null }

const memoryStorage = (saved: string | null = null): MemoryStorage => {
  let value = saved
  return {
    getItem: () => value,
    setItem: (_name, next) => {
      value = next
    },
    removeItem: () => {
      value = null
    },
    read: () => value,
  }
}

type SetUpProps = {
  server?: DownloadServer | null
  saved?: string | null
  /** Files on the disk before the downloads are read. */
  initial?: readonly string[]
}

const setUp = async ({
  server = serverWith().server,
  saved = null,
  initial = [],
}: SetUpProps = {}) => {
  const memory = memoryDisk()
  initial.forEach(memory.put)
  const storage = memoryStorage(saved)
  await configureDownloads({
    storage,
    disk: memory.disk,
    serverOf: (serverId) => (serverId === DOWNLOADS_SERVER_ID ? server : null),
    now: () => 1000,
    // A real tick, so the prepare-ahead loop yields to the fetches' gates and the timers.
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1))),
  })
  return { ...memory, storage }
}

describe('the downloads store', () => {
  beforeEach(() => {
    useDownloads.setState({
      ownerId: null,
      entries: {},
      isRunning: false,
      stamps: 0,
      isPreparingAhead: false,
      controllers: new Map(),
    })
    useDownloadProgress.setState({ readings: {}, samples: {} })
  })

  it("downloads a movie's original file by ticket into its folder, with its title art and poster beside it", async () => {
    const { files, fetched } = await setUp()
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: POSTER,
      logoUri: LOGO,
      items: [videoOf({ media: MOVIE })],
    })
    const folder = folderOf({ serverId: DOWNLOADS_SERVER_ID, mediaId: MOVIE.id })
    expect(fetched()).toEqual([
      LOGO,
      POSTER,
      uriFor({ media: MOVIE, mode: PLAYBACK_MODES.direct, audio: null, burn: null }),
    ])
    expect(files().get(`${folder}/media.mp4`)).toBe(100)
    expect(statusOf(MOVIE.id)).toEqual({ state: DOWNLOAD_STATES.done, bytes: 100 })
    const entry = useDownloads.getState().entries[downloadKeyFor(MOVIE.id)]
    expect(entry?.artPath).toBe(`${folder}/art.jpg`)
    expect(entry?.logoPath).toBe(`${folder}/logo.png`)
    expect(entry?.kind === DOWNLOAD_KINDS.video && entry.tracks).toEqual(TRACKS)
    expect(useDownloadProgress.getState().readings).toEqual({})
  })

  it('waits while the server makes its MP4 copy, saying how far it is, then downloads the copy', async () => {
    let seen: readonly DownloadStatus[] = []
    const unwatch = useDownloads.subscribe((state) => {
      const status = state.entries[downloadKeyFor(MKV.id)]?.status
      if (status !== undefined) seen = [...seen, status]
    })
    const { server } = serverWith({
      answers: [
        { state: DEVICE_DOWNLOAD_STATES.preparing, progress: 0.4 },
        { state: DEVICE_DOWNLOAD_STATES.preparing, progress: 0.8 },
      ],
    })
    const { files, fetched } = await setUp({ server })
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: SEASON_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MKV, way: DOWNLOAD_WAYS.copy })],
    })
    unwatch()
    expect(seen).toContainEqual({ state: DOWNLOAD_STATES.preparing, progress: 0.4 })
    expect(seen).toContainEqual({ state: DOWNLOAD_STATES.preparing, progress: 0.8 })
    expect(fetched()).toEqual([`${ORIGIN}/api/media/${MKV.id}/device-download/file?t=ticket`])
    expect(
      files().has(`${folderOf({ serverId: DOWNLOADS_SERVER_ID, mediaId: MKV.id })}/media.mp4`),
    ).toBe(true)
    const entry = useDownloads.getState().entries[downloadKeyFor(MKV.id)]
    expect(entry?.kind === DOWNLOAD_KINDS.video && entry.tracks).toBeNull()
  })

  it("fails with the server's words when its copy fails, and Retry queues it again", async () => {
    const { server } = serverWith({
      answers: [{ state: DEVICE_DOWNLOAD_STATES.failed, message: 'ffmpeg gave up.' }],
    })
    await setUp({ server })
    const ask = {
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: SEASON_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MKV, way: DOWNLOAD_WAYS.copy })],
    }
    await useDownloads.getState().download(ask)
    expect(statusOf(MKV.id)).toEqual({ state: DOWNLOAD_STATES.failed, message: 'ffmpeg gave up.' })
    await useDownloads.getState().retry({ key: downloadKeyFor(MKV.id) })
    expect(statusOf(MKV.id)).toEqual({ state: DOWNLOAD_STATES.done, bytes: 100 })
  })

  it('fails a download whose server this device no longer holds', async () => {
    await setUp({ server: null })
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    })
    expect(statusOf(MOVIE.id)).toEqual({
      state: DOWNLOAD_STATES.failed,
      message: DOWNLOAD_COPY.unreachable,
    })
  })

  it('fetches one at a time in the queue’s order, the rest waiting their turn, and reads its bytes as they come', async () => {
    const memory = await setUp()
    const gates = [MOVIE, SECOND, THIRD].map((media) =>
      memory.gate(uriFor({ media, mode: PLAYBACK_MODES.direct, audio: null, burn: null })),
    )
    const done = useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [MOVIE, SECOND, THIRD].map((media) => videoOf({ media })),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(statusOf(MOVIE.id)?.state).toBe(DOWNLOAD_STATES.downloading)
    expect(statusOf(SECOND.id)?.state).toBe(DOWNLOAD_STATES.queued)
    expect(statusOf(THIRD.id)?.state).toBe(DOWNLOAD_STATES.queued)
    expect(useDownloads.getState().isRunning).toBe(true)
    expect(useDownloadProgress.getState().readings[downloadKeyFor(MOVIE.id)]).toEqual({
      bytes: 50,
      total: 100,
    })
    gates[0]?.open()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(statusOf(SECOND.id)?.state).toBe(DOWNLOAD_STATES.downloading)
    expect(statusOf(THIRD.id)?.state).toBe(DOWNLOAD_STATES.queued)
    gates.forEach((gate) => gate.open())
    await done
    expect([MOVIE, SECOND, THIRD].map(({ id }) => statusOf(id)?.state)).toEqual([
      DOWNLOAD_STATES.done,
      DOWNLOAD_STATES.done,
      DOWNLOAD_STATES.done,
    ])
    expect(useDownloads.getState().isRunning).toBe(false)
    expect(memory.fetched().filter((uri) => uri.includes('/file?'))).toEqual(
      [MOVIE, SECOND, THIRD].map((media) =>
        uriFor({ media, mode: PLAYBACK_MODES.direct, audio: null, burn: null }),
      ),
    )
  })

  it('moves a queued download before another or to the end, never the one downloading, and fetches in the new order', async () => {
    const memory = await setUp()
    const gates = [MOVIE, SECOND, THIRD].map((media) =>
      memory.gate(uriFor({ media, mode: PLAYBACK_MODES.direct, audio: null, burn: null })),
    )
    const done = useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [MOVIE, SECOND, THIRD].map((media) => videoOf({ media })),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const { move } = useDownloads.getState()
    const placesOf = () =>
      [MOVIE, SECOND, THIRD].map(
        ({ id }) => useDownloads.getState().entries[downloadKeyFor(id)]?.place,
      )
    const before = placesOf()
    // The one downloading stays where it is, and nothing goes before it.
    move({ key: downloadKeyFor(MOVIE.id), before: downloadKeyFor(THIRD.id) })
    move({ key: downloadKeyFor(THIRD.id), before: downloadKeyFor(MOVIE.id) })
    expect(placesOf()).toEqual(before)
    move({ key: downloadKeyFor(THIRD.id), before: downloadKeyFor(SECOND.id) })
    expect(placesOf()).toEqual([before[0], before[2], before[1]])
    move({ key: downloadKeyFor(THIRD.id), before: null })
    expect(placesOf()).toEqual(before)
    move({ key: downloadKeyFor(THIRD.id), before: downloadKeyFor(SECOND.id) })
    gates.forEach((gate) => gate.open())
    await done
    expect(memory.fetched().filter((uri) => uri.includes('/file?'))).toEqual(
      [MOVIE, THIRD, SECOND].map((media) =>
        uriFor({ media, mode: PLAYBACK_MODES.direct, audio: null, burn: null }),
      ),
    )
  })

  it('asks the server for the next two queued copies while one downloads, and says how far each is', async () => {
    let asked: readonly number[] = []
    const { server } = serverWith()
    const watched: DownloadServer = {
      ...server,
      prepare: async (mediaId) => {
        // The second's copy is part way on its first ask, and whole after that.
        const isFirstAsk = !asked.includes(mediaId)
        asked = [...asked, mediaId]
        return mediaId === SECOND.id && isFirstAsk
          ? { state: DEVICE_DOWNLOAD_STATES.preparing, progress: 0.25 }
          : { state: DEVICE_DOWNLOAD_STATES.ready, bytes: 100 }
      },
    }
    const memory = await setUp({ server: watched })
    const gate = memory.gate(
      uriFor({ media: MOVIE, mode: PLAYBACK_MODES.direct, audio: null, burn: null }),
    )
    const done = useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [
        videoOf({ media: MOVIE }),
        videoOf({ media: SECOND, way: DOWNLOAD_WAYS.copy }),
        videoOf({ media: THIRD, way: DOWNLOAD_WAYS.copy }),
        videoOf({ media: MKV, way: DOWNLOAD_WAYS.copy }),
      ],
    })
    await new Promise((resolve) => setTimeout(resolve, 3))
    expect(asked).toContain(SECOND.id)
    expect(asked).toContain(THIRD.id)
    expect(asked).not.toContain(MKV.id)
    expect(statusOf(SECOND.id)?.state).toBe(DOWNLOAD_STATES.queued)
    expect(statusOf(THIRD.id)).toEqual({ state: DOWNLOAD_STATES.queued, preparing: 1 })
    expect(statusOf(MKV.id)).toEqual({ state: DOWNLOAD_STATES.queued, preparing: null })
    gate.open()
    await done
    expect(
      [MOVIE, SECOND, THIRD, MKV].every(({ id }) => statusOf(id)?.state === DOWNLOAD_STATES.done),
    ).toBe(true)
  })

  it('cancels a download on its way: it stops, and it and its bytes go', async () => {
    const memory = await setUp()
    memory.gate(uriFor({ media: MOVIE, mode: PLAYBACK_MODES.direct, audio: null, burn: null }))
    const done = useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await useDownloads.getState().cancel({ key: downloadKeyFor(MOVIE.id) })
    await done
    expect(useDownloads.getState().entries).toEqual({})
    expect(memory.files().size).toBe(0)
    expect(useDownloadProgress.getState().readings).toEqual({})
  })

  it('a download cut short fails, leaving nothing on the disk', async () => {
    const broken = serverWith().server
    const server: DownloadServer = {
      ...broken,
      sources: {
        ...broken.sources,
        source: async () => ({ ok: true, source: { uri: `${ORIGIN}/broken`, headers: {} } }),
      },
    }
    const memory = await setUp({ server })
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    })
    expect(statusOf(MOVIE.id)).toEqual({
      state: DOWNLOAD_STATES.failed,
      message: DOWNLOAD_COPY.failed,
    })
    expect(memory.files().size).toBe(0)
  })

  it("downloads a track's file, or the AAC transcode of one AVPlayer cannot decode", async () => {
    const opus: Track = { ...PARANOID, codec: AUDIO_CODECS.opus, container: CONTAINERS.webm }
    const { server, trackAsks } = serverWith()
    const memory = await setUp({ server })
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: ALBUM_GROUP,
      artUri: null,
      logoUri: null,
      items: [trackOf(AIRBAG), trackOf(opus)],
    })
    expect(trackAsks()).toEqual([null, AUDIO_BITRATES.standard])
    expect(
      memory
        .files()
        .has(`${folderOf({ serverId: DOWNLOADS_SERVER_ID, mediaId: AIRBAG.id })}/media.flac`),
    ).toBe(true)
    expect(
      memory
        .files()
        .has(`${folderOf({ serverId: DOWNLOADS_SERVER_ID, mediaId: opus.id })}/media.m4a`),
    ).toBe(true)
  })

  it('keeps a download asked for again where it is, in the group it came with', async () => {
    await setUp()
    const ask = {
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    }
    await useDownloads.getState().download({ ...ask, group: MOVIE_GROUP })
    await useDownloads.getState().download({ ...ask, group: SEASON_GROUP })
    expect(useDownloads.getState().entries[downloadKeyFor(MOVIE.id)]?.group).toEqual(MOVIE_GROUP)
  })

  it('deletes one download, a group, or every one, with their files', async () => {
    const memory = await setUp()
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    })
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: SEASON_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: SECOND }), videoOf({ media: THIRD })],
    })
    await useDownloads.getState().remove({ key: downloadKeyFor(SECOND.id) })
    expect(Object.keys(useDownloads.getState().entries)).toEqual([
      downloadKeyFor(MOVIE.id),
      downloadKeyFor(THIRD.id),
    ])
    await useDownloads
      .getState()
      .removeGroup({ groupKey: groupKeyOf({ serverId: DOWNLOADS_SERVER_ID, group: SEASON_GROUP }) })
    expect(Object.keys(useDownloads.getState().entries)).toEqual([downloadKeyFor(MOVIE.id)])
    expect(memory.files().size).toBe(1)
    await useDownloads.getState().removeAll()
    expect(useDownloads.getState().entries).toEqual({})
    expect(memory.files().size).toBe(0)
  })

  it('reads back what a relaunch stopped as queued, a lost file as failed, junk dropped and strays deleted', async () => {
    const first = await setUp()
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE }), videoOf({ media: SECOND })],
    })
    const saved: unknown = JSON.parse(first.storage.read() ?? '{}')
    const entries = isRecord(saved) && isRecord(saved.state) ? saved.state.entries : null
    const second = isRecord(entries) ? entries[downloadKeyFor(SECOND.id)] : null
    const stopped = JSON.stringify({
      state: {
        entries: {
          ...(isRecord(entries) ? entries : {}),
          [downloadKeyFor(SECOND.id)]: {
            ...(isRecord(second) ? second : {}),
            status: { state: DOWNLOAD_STATES.downloading },
          },
          junk: { mediaId: 'nope' },
        },
      },
      version: 0,
    })
    useDownloads.setState({ entries: {}, isRunning: false })
    const stray = `${folderOf({ serverId: DOWNLOADS_SERVER_ID, mediaId: 99 })}/media.mp4.part`
    const relaunched = await setUp({ saved: stopped, initial: [stray] })
    expect(statusOf(MOVIE.id)).toEqual({
      state: DOWNLOAD_STATES.failed,
      message: DOWNLOAD_COPY.failed,
    })
    expect(statusOf(SECOND.id)).toEqual({ state: DOWNLOAD_STATES.queued, preparing: null })
    expect(Object.keys(useDownloads.getState().entries)).toHaveLength(2)
    expect(relaunched.files().has(stray)).toBe(false)
    await useDownloads.getState().resume()
    expect(statusOf(SECOND.id)).toEqual({ state: DOWNLOAD_STATES.done, bytes: 100 })
  })

  it('reads the title art from the server for a download asked for before entries kept it', async () => {
    const first = await setUp()
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    })
    const saved: unknown = JSON.parse(first.storage.read() ?? '{}')
    const entries = isRecord(saved) && isRecord(saved.state) ? saved.state.entries : null
    const movie = isRecord(entries) ? entries[downloadKeyFor(MOVIE.id)] : null
    const older = Object.fromEntries(
      Object.entries(isRecord(movie) ? movie : {}).filter(
        ([field]) => field !== 'logoUri' && field !== 'logoPath',
      ),
    )
    const stopped = JSON.stringify({
      state: {
        entries: {
          [downloadKeyFor(MOVIE.id)]: { ...older, status: { state: DOWNLOAD_STATES.downloading } },
        },
      },
      version: 0,
    })
    useDownloads.setState({ entries: {}, isRunning: false })
    const relaunched = await setUp({ saved: stopped })
    await useDownloads.getState().resume()
    const entry = useDownloads.getState().entries[downloadKeyFor(MOVIE.id)]
    expect(relaunched.fetched()[0]).toBe(TITLE_ART)
    expect(entry?.logoUri).toBe(TITLE_ART)
    expect(entry?.logoPath).toBe(
      `${folderOf({ serverId: DOWNLOADS_SERVER_ID, mediaId: MOVIE.id })}/logo.png`,
    )
  })

  it('keeps downloads saved before they had an owner, and lets the first account to sign in claim them', async () => {
    const first = await setUp()
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    })
    const saved: unknown = JSON.parse(first.storage.read() ?? '{}')
    const entries = isRecord(saved) && isRecord(saved.state) ? saved.state.entries : null
    // What an older version wrote: the entries and no owner.
    const unowned = JSON.stringify({ state: { entries }, version: 0 })
    useDownloads.setState({ ownerId: 'stale', entries: {}, isRunning: false })
    const relaunched = await setUp({ saved: unowned, initial: [...first.files().keys()] })
    expect(useDownloads.getState().ownerId).toBeNull()
    expect(statusOf(MOVIE.id)).toEqual({ state: DOWNLOAD_STATES.done, bytes: 100 })

    expect(await useDownloads.getState().keepFor({ accountId: 'ana' })).toBe(false)
    expect(useDownloads.getState().ownerId).toBe('ana')
    expect(statusOf(MOVIE.id)).toEqual({ state: DOWNLOAD_STATES.done, bytes: 100 })
    const kept: unknown = JSON.parse(relaunched.storage.read() ?? '{}')
    expect(isRecord(kept) && isRecord(kept.state) ? kept.state.ownerId : null).toBe('ana')
  })

  it("keeps the downloads through a sign-out and their owner's return, and removes them for another account", async () => {
    const { files } = await setUp()
    const { keepFor } = useDownloads.getState()
    expect(await keepFor({ accountId: 'ana' })).toBe(false)
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    })
    expect(await keepFor({ accountId: null })).toBe(false)
    expect(await keepFor({ accountId: 'ana' })).toBe(false)
    expect(Object.keys(useDownloads.getState().entries)).toEqual([downloadKeyFor(MOVIE.id)])

    expect(await keepFor({ accountId: 'ben' })).toBe(true)
    expect(useDownloads.getState().entries).toEqual({})
    expect(useDownloads.getState().ownerId).toBe('ben')
    expect(files().size).toBe(0)
  })

  it('stores itself under its own key', async () => {
    const memory = await setUp()
    let names: readonly string[] = []
    memory.storage.setItem = (name) => {
      names = [...names, name]
    }
    useDownloads.persist.setOptions({ storage: createJSONStorage(() => memory.storage) })
    await useDownloads.getState().download({
      serverId: DOWNLOADS_SERVER_ID,
      library: null,
      group: MOVIE_GROUP,
      artUri: null,
      logoUri: null,
      items: [videoOf({ media: MOVIE })],
    })
    expect(names).toContain(DOWNLOADS_KEY)
  })
})
