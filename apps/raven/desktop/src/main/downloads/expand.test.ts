import { describe, expect, it } from 'bun:test'
import {
  AUTH_REFUSALS,
  DOWNLOAD_TARGET_KINDS,
  ITEM_TYPES,
  LOCKED_STATUS,
  type MediaItem,
  type Saga,
} from '@raven/core'
import {
  BUSY_TRIES,
  BUSY_WAIT_MS,
  DOWNLOAD_MAX_FILES,
  EXPAND_MESSAGES,
  episodeLabel,
  expandTarget,
  type Expansion,
  EXPAND_REASONS,
} from '@/main/downloads/expand'
import {
  albumDetails,
  details,
  episode,
  fakeCalls,
  keyOf,
  library,
  ok,
  playlistDetails,
  season,
  show,
  summary,
  track,
  type Reply,
} from '@/main/test/serverFakes'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { CALL_MESSAGES, type ServerCalls } from '@/main/servers/serverCalls'
import { mediaItemFor } from '@/shared/test/mediaItem'

const SERVER_ID = '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11'
const SERVER_NAME = 'Vhagar'

type FileProps = { id: number; libraryId?: number }

const file = ({ id, libraryId = 1 }: FileProps): MediaItem =>
  mediaItemFor({ id, libraryId, title: `File ${id}` })

const succeeded = (expansion: Expansion) => {
  if (!expansion.ok) throw new Error(`expected ok, got ${expansion.reason}`)
  return expansion
}

const failed = (expansion: Expansion) => {
  if (expansion.ok) throw new Error('expected a refusal')
  return expansion
}

const library1 = {
  [keyOf({ name: CALL_NAMES.getLibrary, libraryId: 1 })]: ok(
    library({ id: 1, watchedPercent: 90 }),
  ),
}

const itemCall = (itemId: number): string => keyOf({ name: CALL_NAMES.getItem, itemId })
const mediaCall = (mediaId: number): string => keyOf({ name: CALL_NAMES.getMedia, mediaId })
const sagasCall = keyOf({ name: CALL_NAMES.getSagas, libraryId: 1 })
const albumCall = keyOf({ name: CALL_NAMES.getAlbum, albumId: 7 })
const playlistCall = keyOf({ name: CALL_NAMES.getPlaylist, playlistId: 5 })
const library3 = keyOf({ name: CALL_NAMES.getLibrary, libraryId: 3 })

/** Each track's file in music library 3, as `getMedia` answers it. */
const trackFiles = (ids: number[]): Record<string, Reply> =>
  Object.fromEntries([
    [library3, ok(library({ id: 3, watchedPercent: 90 }))],
    ...ids.map((id) => [
      mediaCall(id),
      ok(mediaItemFor({ id, libraryId: 3, title: `Track ${id}`, container: 'flac' })),
    ]),
  ])

type RunProps = {
  replies: Record<string, Reply>
  target: Parameters<typeof expandTarget>[0]['target']
  skip?: (mediaId: number) => boolean
}

const run = ({ replies, target, skip = () => false }: RunProps) => {
  const { calls, log } = fakeCalls({ ...library1, ...replies })
  return {
    log,
    expansion: expandTarget({
      calls,
      serverId: SERVER_ID,
      serverName: SERVER_NAME,
      target,
      skip,
    }),
  }
}

describe('constants', () => {
  it('caps one ask at 500 files', () => {
    expect(DOWNLOAD_MAX_FILES).toBe(500)
  })

  it('words the refusals', () => {
    expect(EXPAND_MESSAGES.tooMany).toBe('That is more than Raven downloads at once.')
    expect(EXPAND_MESSAGES.gone('Vhagar')).toBe('That title is not on Vhagar any more.')
    expect(EXPAND_MESSAGES.unreadable('Vhagar')).toBe(
      'Vhagar answered with something Raven could not read.',
    )
    expect(EXPAND_MESSAGES.account('Vhagar')).toBe('Vhagar did not let your account download that.')
  })
})

describe('episodeLabel', () => {
  it('leads with the season and episode numbers', () => {
    expect(episodeLabel({ season: 2, episode: 4, title: 'Trojan Horse' })).toBe(
      'S02E04 Trojan Horse',
    )
  })

  it('is the title alone without both numbers', () => {
    expect(episodeLabel({ season: null, episode: 4, title: 'Trojan Horse' })).toBe('Trojan Horse')
    expect(episodeLabel({ season: 2, episode: null, title: 'Trojan Horse' })).toBe('Trojan Horse')
  })
})

describe('expandTarget', () => {
  it('reads a media file and its library', async () => {
    const movie = mediaItemFor({
      id: 9,
      libraryId: 1,
      title: 'Fellowship',
      year: 2001,
      item: summary({ id: 1, type: 'movie' }),
    })
    const { expansion, log } = run({
      replies: { [mediaCall(9)]: ok(movie) },
      target: { kind: 'media', mediaId: 9 },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('movie')
    expect(result.title).toBe('Fellowship (2001)')
    expect(result.files).toEqual([
      {
        media: movie,
        label: 'Fellowship (2001)',
        group: { kind: 'movie', key: 'movie:9', title: 'Fellowship (2001)', order: 0 },
        watchedPercent: 90,
      },
    ])
    expect(log).toEqual([mediaCall(9), keyOf({ name: CALL_NAMES.getLibrary, libraryId: 1 })])
  })

  it('makes an episode file an episode of its show', async () => {
    const media = mediaItemFor({
      id: 9,
      title: 'Half Loop',
      item: summary({ id: 6, type: 'episode', title: 'Half Loop', show, season: 1, episode: 2 }),
    })
    const { expansion } = run({
      replies: { [mediaCall(9)]: ok(media) },
      target: { kind: 'media', mediaId: 9 },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('episode')
    expect(result.files[0]?.label).toBe('S01E02 Half Loop')
    expect(result.files[0]?.group).toEqual({
      kind: 'episode',
      key: 'show:4',
      title: 'Severance',
      order: 10_002,
    })
  })

  it('reads a show, then each season in order, and lists each episode', async () => {
    const one = file({ id: 11 })
    const two = file({ id: 12 })
    const three = file({ id: 21 })
    const { expansion, log } = run({
      replies: {
        [itemCall(4)]: ok(
          details({
            id: 4,
            type: 'show',
            title: 'Severance',
            children: [season({ id: 5, number: 1 }), season({ id: 6, number: 2 })],
          }),
        ),
        [itemCall(5)]: ok(
          details({
            id: 5,
            type: 'season',
            title: 'Season 1',
            show,
            season: 1,
            children: [
              episode({ id: 51, season: 1, number: 1, title: 'Good News', primary: one }),
              episode({ id: 52, season: 1, number: 2, title: 'Half Loop', primary: two }),
            ],
          }),
        ),
        [itemCall(6)]: ok(
          details({
            id: 6,
            type: 'season',
            title: 'Season 2',
            show,
            season: 2,
            children: [
              episode({ id: 61, season: 2, number: 1, title: 'Hello', primary: three }),
              episode({ id: 62, season: 2, number: 2, title: 'No file', primary: null }),
            ],
          }),
        ),
      },
      target: { kind: 'item', itemId: 4 },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('show')
    expect(result.title).toBe('Severance')
    expect(result.files.map(({ media, label, group }) => [media.id, label, group])).toEqual([
      [11, 'S01E01 Good News', { kind: 'show', key: 'show:4', title: 'Severance', order: 10_001 }],
      [12, 'S01E02 Half Loop', { kind: 'show', key: 'show:4', title: 'Severance', order: 10_002 }],
      [21, 'S02E01 Hello', { kind: 'show', key: 'show:4', title: 'Severance', order: 20_001 }],
    ])
    expect(log.slice(0, 3)).toEqual([itemCall(4), itemCall(5), itemCall(6)])
  })

  it('reads a season and orders its episodes by number', async () => {
    const { expansion } = run({
      replies: {
        [itemCall(5)]: ok(
          details({
            id: 5,
            type: 'season',
            title: 'Season 1',
            show,
            season: 1,
            children: [
              episode({
                id: 51,
                season: 1,
                number: 1,
                title: 'Good News',
                primary: file({ id: 11 }),
              }),
            ],
          }),
        ),
      },
      target: { kind: 'item', itemId: 5 },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('season')
    expect(result.title).toBe('Severance · S01')
    expect(result.files[0]?.group).toEqual({
      kind: 'season',
      key: 'show:4',
      title: 'Severance',
      order: 10_001,
    })
  })

  it('lists a two-episode file once, as its first episode', async () => {
    const both = file({ id: 11 })
    const { expansion } = run({
      replies: {
        [itemCall(5)]: ok(
          details({
            id: 5,
            type: 'season',
            title: 'Season 1',
            show,
            season: 1,
            children: [
              episode({ id: 51, season: 1, number: 1, title: 'Part One', primary: both }),
              episode({ id: 52, season: 1, number: 2, title: 'Part Two', primary: both }),
              episode({ id: 53, season: 1, number: 3, title: 'After', primary: file({ id: 13 }) }),
            ],
          }),
        ),
      },
      target: { kind: 'item', itemId: 5 },
    })
    const result = succeeded(await expansion)
    expect(result.files.map(({ media, label, group }) => [media.id, label, group.order])).toEqual([
      [11, 'S01E01 Part One', 10_001],
      [13, 'S01E03 After', 10_003],
    ])
  })

  it('counts a two-episode file once toward the cap', async () => {
    const shared = file({ id: 1 })
    const children = Array.from({ length: DOWNLOAD_MAX_FILES + 1 }, (_, index) =>
      episode({
        id: 1000 + index,
        season: 1,
        number: index + 1,
        title: `Episode ${index + 1}`,
        primary: index < 2 ? shared : file({ id: index + 1 }),
      }),
    )
    const { expansion } = run({
      replies: {
        [itemCall(5)]: ok(
          details({ id: 5, type: 'season', title: 'Season 1', show, season: 1, children }),
        ),
      },
      target: { kind: 'item', itemId: 5 },
    })
    expect(succeeded(await expansion).files).toHaveLength(DOWNLOAD_MAX_FILES)
  })

  it("keys an episode, its season and its show by the show's item id", async () => {
    const episodeFile = mediaItemFor({
      id: 9,
      title: 'Half Loop',
      item: summary({ id: 52, type: 'episode', title: 'Half Loop', show, season: 1, episode: 2 }),
    })
    const seasonDetails = details({
      id: 5,
      type: 'season',
      title: 'Season 1',
      show,
      season: 1,
      children: [episode({ id: 51, season: 1, number: 1, title: 'A', primary: file({ id: 11 }) })],
    })
    const replies = {
      [mediaCall(9)]: ok(episodeFile),
      [itemCall(5)]: ok(seasonDetails),
      [itemCall(4)]: ok(
        details({
          id: 4,
          type: 'show',
          title: 'Severance',
          children: [season({ id: 5, number: 1 })],
        }),
      ),
    }
    const keys = await Promise.all(
      [
        { kind: 'media', mediaId: 9 } as const,
        { kind: 'item', itemId: 5 } as const,
        { kind: 'item', itemId: 4 } as const,
      ].map(
        async (target) => succeeded(await run({ replies, target }).expansion).files[0]?.group.key,
      ),
    )
    expect(keys).toEqual(['show:4', 'show:4', 'show:4'])
  })

  it('keys a season the server places under no show by its own id', async () => {
    const { expansion } = run({
      replies: {
        [itemCall(5)]: ok(
          details({
            id: 5,
            type: 'season',
            title: 'Season 1',
            show: null,
            season: 1,
            children: [
              episode({ id: 51, season: 1, number: 1, title: 'A', primary: file({ id: 11 }) }),
            ],
          }),
        ),
      },
      target: { kind: 'item', itemId: 5 },
    })
    expect(succeeded(await expansion).files[0]?.group.key).toBe('item:5')
  })

  it('takes the first version of an episode item', async () => {
    const { expansion } = run({
      replies: {
        [itemCall(6)]: ok(
          details({
            id: 6,
            type: 'episode',
            title: 'Half Loop',
            show,
            season: 1,
            episode: 2,
            versions: [file({ id: 31 }), file({ id: 32 })],
          }),
        ),
      },
      target: { kind: 'item', itemId: 6 },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('episode')
    expect(result.files.map(({ media }) => media.id)).toEqual([31])
    expect(result.files[0]?.label).toBe('S01E02 Half Loop')
    expect(result.files[0]?.group).toEqual({
      kind: 'episode',
      key: 'show:4',
      title: 'Severance',
      order: 10_002,
    })
  })

  it('takes the first version of a movie item', async () => {
    const { expansion } = run({
      replies: {
        [itemCall(1)]: ok(
          details({
            id: 1,
            versions: [mediaItemFor({ id: 31, title: 'Fellowship', year: 2001 }), file({ id: 32 })],
          }),
        ),
      },
      target: { kind: 'item', itemId: 1 },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('movie')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.media.id).toBe(31)
    expect(result.files[0]?.group.order).toBe(0)
    expect(result.files[0]?.group.key).toBe('movie:31')
  })

  it('answers gone for a movie with no file this session may see', async () => {
    const { expansion } = run({
      replies: { [itemCall(1)]: ok(details({ id: 1, versions: [] })) },
      target: { kind: 'item', itemId: 1 },
    })
    const result = failed(await expansion)
    expect(result.reason).toBe('gone')
    expect(result.message).toBe(EXPAND_MESSAGES.gone(SERVER_NAME))
  })

  it('picks the saga by its tmdb id and orders its movies', async () => {
    const sagas: Saga[] = [
      { tmdbId: '1', name: 'Other', backdrop: { type: 'slideshow', motion: 'fade' }, media: [] },
      {
        tmdbId: '119',
        name: 'The Lord of the Rings Collection',
        backdrop: { type: 'slideshow', motion: 'fade' },
        media: [
          mediaItemFor({ id: 41, title: 'Fellowship', year: 2001 }),
          mediaItemFor({ id: 42, title: 'Two Towers', year: 2002 }),
        ],
      },
    ]
    const { expansion } = run({
      replies: { [sagasCall]: ok(sagas) },
      target: { kind: 'saga', libraryId: 1, tmdbId: '119' },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('saga')
    expect(result.title).toBe('The Lord of the Rings Collection')
    expect(result.files.map(({ media, label, group }) => [media.id, label, group])).toEqual([
      [
        41,
        'Fellowship (2001)',
        { kind: 'saga', key: 'saga:1:119', title: 'The Lord of the Rings Collection', order: 0 },
      ],
      [
        42,
        'Two Towers (2002)',
        { kind: 'saga', key: 'saga:1:119', title: 'The Lord of the Rings Collection', order: 1 },
      ],
    ])
  })

  it('answers gone for a saga the library does not have', async () => {
    const { expansion } = run({
      replies: { [sagasCall]: ok([]) },
      target: { kind: 'saga', libraryId: 1, tmdbId: '119' },
    })
    const result = failed(await expansion)
    expect(result.reason).toBe('gone')
    expect(result.message).toBe('That title is not on Vhagar any more.')
  })

  it('leaves a skipped file out but counts it', async () => {
    const sagas: Saga[] = [
      {
        tmdbId: '119',
        name: 'Saga',
        backdrop: { type: 'slideshow', motion: 'fade' },
        media: [file({ id: 41 }), file({ id: 42 })],
      },
    ]
    const { expansion } = run({
      replies: { [sagasCall]: ok(sagas) },
      target: { kind: 'saga', libraryId: 1, tmdbId: '119' },
      skip: (mediaId) => mediaId === 41,
    })
    const result = succeeded(await expansion)
    expect(result.files.map(({ media }) => media.id)).toEqual([42])
  })

  it('counts a skipped file toward the cap', async () => {
    const media = Array.from({ length: DOWNLOAD_MAX_FILES + 1 }, (_, index) =>
      file({ id: index + 1 }),
    )
    const sagas: Saga[] = [
      {
        tmdbId: '119',
        name: 'Saga',
        backdrop: { type: 'slideshow', motion: 'fade' },
        media,
      },
    ]
    const { expansion } = run({
      replies: { [sagasCall]: ok(sagas) },
      target: { kind: 'saga', libraryId: 1, tmdbId: '119' },
      skip: (mediaId) => mediaId > 1,
    })
    const result = failed(await expansion)
    expect(result.reason).toBe('tooMany')
    expect(result.message).toBe(EXPAND_MESSAGES.tooMany)
  })

  it('expands an album to one file per track in disc order, grouped under the album', async () => {
    const tracks = [
      track({ id: 203, title: 'Lucky', disc: 2, number: 1 }),
      track({ id: 102, title: 'Paranoid Android', disc: 1, number: 2 }),
      track({ id: 101, title: 'Airbag', disc: 1, number: 1 }),
    ]
    const { expansion, log } = run({
      replies: { [albumCall]: ok(albumDetails(tracks)), ...trackFiles([101, 102, 203]) },
      target: { kind: 'album', albumId: 7 },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('album')
    expect(result.title).toBe('OK Computer')
    expect(result.files.map(({ media, label, group }) => ({ id: media.id, label, group }))).toEqual(
      [
        { id: 101, label: 'Airbag', order: 0 },
        { id: 102, label: 'Paranoid Android', order: 1 },
        { id: 203, label: 'Lucky', order: 2 },
      ].map(({ id, label, order }) => ({
        id,
        label,
        group: {
          kind: 'album',
          key: 'album:7',
          title: 'OK Computer',
          order,
          cover: { albumId: 7, coverVersion: 'cover-v1' },
        },
      })),
    )
    expect(result.files.every(({ watchedPercent }) => watchedPercent === 90)).toBe(true)
    expect(result.files.map((each) => each.track)).toEqual([tracks[2], tracks[1], tracks[0]])
    expect(log[0]).toBe(albumCall)
  })

  it('expands a playlist in its order, with no file for a track it leaves out and one for a track it holds twice', async () => {
    // Track 102 is in a locked library, so the server's playlist leaves it out.
    const tracks = [
      track({
        id: 301,
        albumId: 9,
        title: 'Teardrop',
        album: { title: 'Mezzanine', coverVersion: 'm1' },
      }),
      track({ id: 101, title: 'Airbag' }),
      track({
        id: 301,
        albumId: 9,
        title: 'Teardrop',
        album: { title: 'Mezzanine', coverVersion: 'm1' },
      }),
    ]
    const { expansion, log } = run({
      replies: { [playlistCall]: ok(playlistDetails(tracks)), ...trackFiles([101, 301]) },
      target: { kind: 'playlist', playlistId: 5 },
    })
    const result = succeeded(await expansion)
    expect(result.kind).toBe('playlist')
    expect(result.title).toBe('Late night')
    expect(result.files.map(({ media, group }) => [media.id, group])).toEqual([
      [
        301,
        {
          kind: 'playlist',
          key: 'playlist:5',
          title: 'Late night',
          order: 0,
          cover: { albumId: 9, coverVersion: 'm1' },
        },
      ],
      [
        101,
        {
          kind: 'playlist',
          key: 'playlist:5',
          title: 'Late night',
          order: 1,
          cover: { albumId: 9, coverVersion: 'm1' },
        },
      ],
    ])
    expect(result.files.map((each) => each.track)).toEqual([tracks[0], tracks[1]])
    expect(log).not.toContain(mediaCall(102))
    expect(log.filter((key) => key === mediaCall(301))).toHaveLength(1)
  })

  it('reads no file for a track already downloaded', async () => {
    const tracks = [track({ id: 101 }), track({ id: 102, number: 2 })]
    const { expansion, log } = run({
      replies: { [albumCall]: ok(albumDetails(tracks)), ...trackFiles([101, 102]) },
      target: { kind: 'album', albumId: 7 },
      skip: (mediaId) => mediaId === 101,
    })
    const result = succeeded(await expansion)
    expect(result.files.map(({ media, group }) => [media.id, group.order])).toEqual([[102, 1]])
    expect(log).not.toContain(mediaCall(101))
  })

  it('gives an empty playlist no cover and no files', async () => {
    const { expansion } = run({
      replies: { [playlistCall]: ok(playlistDetails([])) },
      target: { kind: 'playlist', playlistId: 5 },
    })
    expect(succeeded(await expansion).files).toEqual([])
  })

  it('answers tooMany for a playlist past the cap before reading any file', async () => {
    const tracks = Array.from({ length: DOWNLOAD_MAX_FILES + 1 }, (_, index) =>
      track({ id: index + 1 }),
    )
    const { expansion, log } = run({
      replies: { [playlistCall]: ok(playlistDetails(tracks)) },
      target: { kind: 'playlist', playlistId: 5 },
      skip: (mediaId) => mediaId > 1,
    })
    expect(failed(await expansion).reason).toBe('tooMany')
    expect(log).toEqual([playlistCall])
  })

  it('answers with the refusal of a track file it cannot read', async () => {
    const tracks = [track({ id: 101 }), track({ id: 102, number: 2 })]
    const { expansion } = run({
      replies: {
        [albumCall]: ok(albumDetails(tracks)),
        ...trackFiles([101]),
        [mediaCall(102)]: { status: LOCKED_STATUS, body: '' },
      },
      target: { kind: 'album', albumId: 7 },
    })
    expect(failed(await expansion).reason).toBe('locked')
  })

  it('asks again while the server is busy, then reads the track', async () => {
    const tracks = [track({ id: 101 })]
    const { calls: answering, log } = fakeCalls({
      ...library1,
      [albumCall]: ok(albumDetails(tracks)),
      ...trackFiles([101]),
    })
    const busy = { left: 2 }
    const calls: Pick<ServerCalls, 'call'> = {
      call: async (input) => {
        if (input.call.name !== CALL_NAMES.getMedia || busy.left === 0) return answering.call(input)
        busy.left -= 1
        return { ok: false, message: CALL_MESSAGES.busy(SERVER_NAME), isBusy: true }
      },
    }
    const started = Date.now()
    const result = succeeded(
      await expandTarget({
        calls,
        serverId: SERVER_ID,
        serverName: SERVER_NAME,
        target: { kind: 'album', albumId: 7 },
        skip: () => false,
      }),
    )
    expect(result.files.map(({ media }) => media.id)).toEqual([101])
    expect(log.filter((key) => key === mediaCall(101))).toHaveLength(1)
    expect(Date.now() - started).toBeGreaterThanOrEqual(2 * BUSY_WAIT_MS - 20)
  })

  it('gives up as unreachable once the server stays busy through every try', async () => {
    const tries = { count: 0 }
    const calls: Pick<ServerCalls, 'call'> = {
      call: async () => {
        tries.count += 1
        return { ok: false, message: CALL_MESSAGES.busy(SERVER_NAME), isBusy: true }
      },
    }
    const result = failed(
      await expandTarget({
        calls,
        serverId: SERVER_ID,
        serverName: SERVER_NAME,
        target: { kind: 'album', albumId: 7 },
        skip: () => false,
      }),
    )
    expect(result.reason).toBe('unreachable')
    expect(result.message).toBe('Raven is still waiting on Vhagar.')
    expect(tries.count).toBe(BUSY_TRIES)
  })

  it('answers gone for an album or playlist the server does not have', async () => {
    const album = run({ replies: {}, target: { kind: 'album', albumId: 7 } })
    expect(failed(await album.expansion).reason).toBe('gone')
    const playlist = run({ replies: {}, target: { kind: 'playlist', playlistId: 5 } })
    expect(failed(await playlist.expansion).reason).toBe('gone')
  })

  it('answers tooMany for 501 episodes and allows 500', async () => {
    const season501 = (count: number) =>
      details({
        id: 5,
        type: 'season',
        title: 'Season 1',
        show,
        season: 1,
        children: Array.from({ length: count }, (_, index) =>
          episode({
            id: 1000 + index,
            season: 1,
            number: index + 1,
            title: `Episode ${index + 1}`,
            primary: file({ id: index + 1 }),
          }),
        ),
      })
    const over = run({
      replies: { [itemCall(5)]: ok(season501(DOWNLOAD_MAX_FILES + 1)) },
      target: { kind: 'item', itemId: 5 },
    })
    expect(failed(await over.expansion).reason).toBe('tooMany')
    const exact = run({
      replies: { [itemCall(5)]: ok(season501(DOWNLOAD_MAX_FILES)) },
      target: { kind: 'item', itemId: 5 },
    })
    expect(succeeded(await exact.expansion).files).toHaveLength(DOWNLOAD_MAX_FILES)
  })

  it('reads a library once for two episodes of it, and each library on its own', async () => {
    const { expansion, log } = run({
      replies: {
        [keyOf({ name: CALL_NAMES.getLibrary, libraryId: 2 })]: ok(
          library({ id: 2, watchedPercent: 80 }),
        ),
        [itemCall(5)]: ok(
          details({
            id: 5,
            type: 'season',
            title: 'Season 1',
            show,
            season: 1,
            children: [
              episode({ id: 51, season: 1, number: 1, title: 'A', primary: file({ id: 11 }) }),
              episode({ id: 52, season: 1, number: 2, title: 'B', primary: file({ id: 12 }) }),
              episode({
                id: 53,
                season: 1,
                number: 3,
                title: 'C',
                primary: file({ id: 13, libraryId: 2 }),
              }),
            ],
          }),
        ),
      },
      target: { kind: 'item', itemId: 5 },
    })
    const result = succeeded(await expansion)
    expect(result.files.map(({ watchedPercent }) => watchedPercent)).toEqual([90, 90, 80])
    expect(
      log.filter((key) => key === keyOf({ name: CALL_NAMES.getLibrary, libraryId: 1 })),
    ).toHaveLength(1)
    expect(
      log.filter((key) => key === keyOf({ name: CALL_NAMES.getLibrary, libraryId: 2 })),
    ).toHaveLength(1)
  })

  it('answers locked for a 423', async () => {
    const { expansion } = run({
      replies: { [itemCall(5)]: { status: LOCKED_STATUS, body: '' } },
      target: { kind: 'item', itemId: 5 },
    })
    expect(failed(await expansion).reason).toBe('locked')
  })

  it('answers locked when a season read of a show is locked', async () => {
    const { expansion } = run({
      replies: {
        [itemCall(4)]: ok(
          details({
            id: 4,
            type: 'show',
            title: 'Severance',
            children: [season({ id: 5, number: 1 })],
          }),
        ),
        [itemCall(5)]: { status: LOCKED_STATUS, body: '' },
      },
      target: { kind: 'item', itemId: 4 },
    })
    expect(failed(await expansion).reason).toBe('locked')
  })

  it('answers gone for a 404, asking nothing more', async () => {
    const { expansion, log } = run({
      replies: {},
      target: { kind: DOWNLOAD_TARGET_KINDS.item, itemId: 5 },
    })
    const result = failed(await expansion)
    expect(result.reason).toBe(EXPAND_REASONS.gone)
    expect(result.message).toBe(EXPAND_MESSAGES.gone(SERVER_NAME))
    expect(log).toEqual([itemCall(5)])
  })

  it('answers gone for a title deep in a show', async () => {
    const { expansion } = run({
      replies: {
        [itemCall(4)]: ok(
          details({
            id: 4,
            type: ITEM_TYPES.show,
            title: 'Severance',
            children: [season({ id: 5, number: 1 })],
          }),
        ),
      },
      target: { kind: DOWNLOAD_TARGET_KINDS.item, itemId: 4 },
    })
    expect(failed(await expansion).reason).toBe(EXPAND_REASONS.gone)
  })

  it('carries the message of an unreachable call', async () => {
    const { expansion } = run({
      replies: { [itemCall(5)]: { unreachable: 'Raven could not reach Vhagar.' } },
      target: { kind: 'item', itemId: 5 },
    })
    const result = failed(await expansion)
    expect(result.reason).toBe('unreachable')
    expect(result.message).toBe('Raven could not reach Vhagar.')
  })

  it.each([
    [401, AUTH_REFUSALS.signedOut],
    [403, AUTH_REFUSALS.pending],
    [403, AUTH_REFUSALS.revoked],
    [403, AUTH_REFUSALS.notOwner],
  ])('answers account for a %i refusing the account as %s', async (status, reason) => {
    const { expansion } = run({
      replies: { [itemCall(5)]: { status, body: { reason, message: 'Sign in.' } } },
      target: { kind: DOWNLOAD_TARGET_KINDS.item, itemId: 5 },
    })
    expect(failed(await expansion)).toEqual({
      ok: false,
      reason: EXPAND_REASONS.account,
      message: EXPAND_MESSAGES.account(SERVER_NAME),
    })
  })

  it('answers unreachable for a 401 or 403 that names no account refusal', async () => {
    const bare = run({
      replies: { [itemCall(5)]: { status: 401, body: '' } },
      target: { kind: DOWNLOAD_TARGET_KINDS.item, itemId: 5 },
    })
    expect(failed(await bare.expansion).reason).toBe(EXPAND_REASONS.unreachable)
    const down = run({
      replies: {
        [itemCall(5)]: { status: 403, body: { reason: AUTH_REFUSALS.unavailable, message: 'x' } },
      },
      target: { kind: DOWNLOAD_TARGET_KINDS.item, itemId: 5 },
    })
    expect(failed(await down.expansion).reason).toBe(EXPAND_REASONS.unreachable)
  })

  it('answers unreachable for a server error', async () => {
    const { expansion } = run({
      replies: { [itemCall(5)]: { status: 500, body: '' } },
      target: { kind: 'item', itemId: 5 },
    })
    expect(failed(await expansion).reason).toBe('unreachable')
  })

  it('answers unreadable for a body that is not an item', async () => {
    const { expansion } = run({
      replies: { [itemCall(5)]: ok({ id: 5 }) },
      target: { kind: 'item', itemId: 5 },
    })
    const result = failed(await expansion)
    expect(result.reason).toBe('unreadable')
    expect(result.message).toBe(EXPAND_MESSAGES.unreadable(SERVER_NAME))
  })

  it('answers unreadable for a body that is not JSON', async () => {
    const { expansion } = run({
      replies: { [itemCall(5)]: ok('<html>') },
      target: { kind: 'item', itemId: 5 },
    })
    expect(failed(await expansion).reason).toBe('unreadable')
  })

  it('answers unreadable when the library cannot be read', async () => {
    const { calls } = fakeCalls({
      [mediaCall(9)]: ok(mediaItemFor({ id: 9 })),
      [keyOf({ name: CALL_NAMES.getLibrary, libraryId: 1 })]: ok({ id: 1 }),
    })
    const result = failed(
      await expandTarget({
        calls,
        serverId: SERVER_ID,
        serverName: SERVER_NAME,
        target: { kind: 'media', mediaId: 9 },
        skip: () => false,
      }),
    )
    expect(result.reason).toBe('unreadable')
  })
})
