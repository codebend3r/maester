import { describe, expect, it } from 'bun:test'
import {
  type ApiClient,
  ApiError,
  type FetchInit,
  type FetchResponse,
  type MediaAccess,
  createApiClient,
  isLockedError,
  parseServerEvent,
} from '@/apiClient'
import { WEB_HOST_ERRORS } from '@/desktop/webHost'
import {
  BACKDROP_OWN_WIDTH,
  BUG_REPORT_STATUSES,
  CDN_BACKDROP_WIDTHS,
  CDN_POSTER_WIDTHS,
  DEFAULT_SAGA_BACKDROP,
  POSTER_OWN_WIDTH,
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_PATHS,
  AUTH_REFUSALS,
  AUTH_SCHEME,
  MEMBER_STATUSES,
  MEDIA_ORIGIN_KINDS,
  PLAYBACK_MODES,
  type HomeShelf,
  type ItemImageOptions,
  type ItemMetadataState,
  MEDIA_PROBE_BYTES,
  type MediaOrigin,
  type MediaStreams,
  type MediaTracks,
  type MetadataHealth,
  type PersonDetails,
} from '@/contract'
import {
  bugReport,
  itemDetails,
  itemSummary,
  library,
  mediaItem,
  playbackDiagnostics,
  showEntry,
} from '@/test/fixtures'

type Call = { url: string; init?: FetchInit }

type RespondProps = { status?: number; body?: unknown }

const respond = ({ status = 200, body }: RespondProps): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})

const clientReturning = (response: FetchResponse) => {
  const calls: Call[] = []
  const client = createApiClient({
    baseUrl: 'http://nas:8484/',
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response
    },
  })
  return { client, calls }
}

describe('account API client', () => {
  it('reads public configuration and preserves structured refusals', async () => {
    const config = { state: AUTH_CONFIG_STATES.off }
    expect(await clientReturning(respond({ body: config })).client.getAuthConfig()).toEqual(config)
    const refusal = { reason: AUTH_REFUSALS.pending, message: 'Awaiting approval.' }
    await expect(
      clientReturning(respond({ status: 403, body: refusal })).client.getMe(),
    ).rejects.toMatchObject({ status: 403, refusal, message: refusal.message })
  })

  it('checks responses before exposing account data', async () => {
    const bad = clientReturning(respond({ body: { email: 'not-a-complete-account' } }))
    await expect(bad.client.getMe()).rejects.toMatchObject({ status: 502 })
    await expect(bad.client.listMembers()).rejects.toMatchObject({ status: 502 })
  })

  it('re-reads the token for every API request and stops sending it after sign out', async () => {
    const calls: Call[] = []
    let token: string | null = 'session-token'
    const client = createApiClient({
      accessToken: () => token,
      fetch: async (url, init) => {
        calls.push({ url, init })
        return respond({ body: { state: AUTH_CONFIG_STATES.off } })
      },
    })
    await client.getAuthConfig()
    token = null
    await client.getAuthConfig()
    expect(calls[0]?.init?.headers?.[AUTH_HEADERS.authorization] ?? null).toBe(
      `${AUTH_SCHEME} session-token`,
    )
    expect(calls[1]?.init?.headers?.[AUTH_HEADERS.authorization] ?? null).toBeNull()
  })

  it('never sends Bearer to explicit media URLs, including same-origin subtitle fetches', async () => {
    const calls: Call[] = []
    const client = createApiClient({
      baseUrl: 'https://raven.example.test',
      accessToken: () => 'private-token',
      fetch: async (url, init) => {
        calls.push({ url, init })
        return respond({ body: 'WEBVTT\n\n' })
      },
    })
    await client.getSubtitles({ id: 7, trackId: 'external-0' })
    await client.getSubtitles({
      id: 7,
      trackId: 'external-0',
      access: {
        origin: { kind: MEDIA_ORIGIN_KINDS.public, url: 'https://media.example.test' },
        ticket: 'opaque-ticket',
      },
    })
    expect(calls).toHaveLength(2)
    calls.forEach(({ init }) =>
      expect(init?.headers?.[AUTH_HEADERS.authorization] ?? null).toBeNull(),
    )
    expect(client.fileUrl({ id: 7 })).not.toContain('private-token')
  })

  it('sends bounded member-list options and explicit status writes', async () => {
    const account = {
      id: '30000000-0000-4000-8000-000000000001',
      email: 'member@maester.test',
      status: MEMBER_STATUSES.approved,
      isOwner: false,
    }
    const list = clientReturning(respond({ body: [account] }))
    expect(await list.client.listMembers({ pageSize: 10, pageOffset: 20 })).toEqual([account])
    expect(list.calls[0]?.url ?? '').toContain(`${AUTH_PATHS.members}?pageSize=10&pageOffset=20`)
    const write = clientReturning(respond({ body: account }))
    expect(
      await write.client.setMemberStatus({
        id: account.id,
        change: { status: MEMBER_STATUSES.approved },
      }),
    ).toEqual(account)
    expect(write.calls[0]?.init?.body ?? '').toBe(
      JSON.stringify({ status: MEMBER_STATUSES.approved }),
    )
  })
})

describe('createApiClient', () => {
  it('returns media that passes the guard', async () => {
    const item = mediaItem()
    const { client, calls } = clientReturning(respond({ body: [item] }))
    await expect(client.listMedia({ libraryId: 3, search: ' matrix ' })).resolves.toEqual([item])
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/media?sort=title&q=matrix')
  })

  it('sends the shuffle seed with a random sort', async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await client.listMedia({ libraryId: 3, sort: 'random', seed: 42 })
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/media?sort=random&seed=42')
  })

  it('asks the server to match a library again', async () => {
    const { client, calls } = clientReturning(respond({ body: library() }))
    await expect(client.matchLibrary(3)).resolves.toEqual(library())
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/libraries/3/match',
      init: { method: 'POST' },
    })
  })

  it.each([
    { call: 'scanLibrary', path: 'scan' },
    { call: 'cancelScan', path: 'scan/cancel' },
    { call: 'quickScanLibrary', path: 'quick-scan' },
    { call: 'cancelQuickScan', path: 'quick-scan/cancel' },
    { call: 'updateLibraryRatings', path: 'ratings' },
    { call: 'cancelLibraryRatings', path: 'ratings/cancel' },
  ] as const)('posts $call to the library’s $path', async ({ call, path }) => {
    const { client, calls } = clientReturning(respond({ body: library() }))
    await expect(client[call](3)).resolves.toEqual(library())
    expect(calls[0]).toMatchObject({
      url: `http://nas:8484/api/libraries/3/${path}`,
      init: { method: 'POST' },
    })
  })

  it('reads and writes an item’s metadata over TMDB’s', async () => {
    const state: ItemMetadataState = {
      shown: {
        title: 'Heat (Director’s Cut)',
        year: 1995,
        tagline: null,
        summary: null,
        contentRating: 'R',
      },
      original: { title: 'Heat', year: 1995, tagline: null, summary: null, contentRating: 'R' },
      overridden: ['title'],
    }
    const { client, calls } = clientReturning(respond({ body: state }))
    await expect(client.getItemMetadata(9)).resolves.toEqual(state)
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/9/metadata')
    const edited = clientReturning(respond({ body: itemDetails() }))
    await edited.client.setItemMetadata({ id: 9, change: { title: null, tagline: 'Hot.' } })
    expect(edited.calls[0]).toMatchObject({
      url: 'http://nas:8484/api/items/9/metadata',
      init: { method: 'PUT', body: '{"title":null,"tagline":"Hot."}' },
    })
  })

  it('lists the pictures an item could show, and chooses one', async () => {
    const options: ItemImageOptions = {
      poster: [
        {
          source: 'tmdb',
          ref: '/p1.jpg',
          width: 2000,
          height: 3000,
          language: 'en',
          current: true,
        },
      ],
      backdrop: [],
      logo: [],
    }
    const { client, calls } = clientReturning(respond({ body: options }))
    await expect(client.getItemImages(9)).resolves.toEqual(options)
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/9/images')

    const chosen = clientReturning(respond({ body: itemDetails() }))
    await chosen.client.chooseItemImage({ id: 9, kind: 'backdrop', choice: { source: 'local' } })
    expect(chosen.calls[0]).toMatchObject({
      url: 'http://nas:8484/api/items/9/images/backdrop',
      init: { method: 'PUT', body: '{"source":"local"}' },
    })

    const option = options.poster[0]
    if (!option) throw new Error('no option')
    expect(
      client.imageOptionUrl({ id: 9, kind: 'poster', option: { ...option, source: 'tmdb' } }),
    ).toBe('http://nas:8484/api/images/poster/p1.jpg')
    expect(
      client.imageOptionUrl({ id: 9, kind: 'poster', option: { ...option, source: 'local' } }),
    ).toBe('http://nas:8484/api/items/9/images/poster/local')
  })

  it('sends JSON bodies', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.saveProgress({ id: 7, position: 93.5, audio: 1 })
    expect(calls[0]?.init).toMatchObject({
      method: 'PUT',
      body: '{"position":93.5,"audio":1}',
      headers: { 'content-type': 'application/json' },
    })
  })

  it('surfaces the server error message', async () => {
    const { client } = clientReturning(
      respond({ status: 400, body: { statusCode: 400, message: ['Add at least one folder.'] } }),
    )
    await expect(client.createLibrary({ name: 'x', paths: [] })).rejects.toThrow(
      new ApiError({ status: 400, message: 'Add at least one folder.' }),
    )
  })

  it('rejects a response that does not match the contract', async () => {
    const { client } = clientReturning(respond({ body: [{ id: 'nope' }] }))
    await expect(client.listLibraries()).rejects.toBeInstanceOf(ApiError)
  })

  it('only hands out a thumbnail URL once one exists', () => {
    const { client } = clientReturning(respond({}))
    expect(client.thumbnailUrl(mediaItem({ id: 4, thumbnailVersion: 99 }))).toBe(
      'http://nas:8484/api/media/4/thumbnail?v=99',
    )
    expect(client.thumbnailUrl(mediaItem({ thumbnail: 'pending' }))).toBeNull()
  })

  it('points a player at the original file', () => {
    const { client } = clientReturning(respond({}))
    expect(client.fileUrl({ id: 5 })).toBe('http://nas:8484/api/media/5/file')
  })

  it('marks a favourite and returns the updated item', async () => {
    const item = mediaItem({ id: 4, favourite: true })
    const { client, calls } = clientReturning(respond({ body: item }))
    await expect(client.setFavourite({ id: 4, favourite: true })).resolves.toEqual(item)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/4/favourite')
    expect(calls[0]?.init).toMatchObject({ method: 'PUT', body: '{"favourite":true}' })
  })

  it('marks targets watched or unwatched with one request', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.setWatched({
      watched: true,
      targets: [
        { kind: 'media', id: 4 },
        { kind: 'item', id: 9, libraryId: null },
      ],
    })
    expect(calls[0]?.url).toBe('http://nas:8484/api/watched')
    expect(calls[0]?.init).toMatchObject({
      method: 'PUT',
      body: '{"watched":true,"targets":[{"kind":"media","id":4},{"kind":"item","id":9,"libraryId":null}]}',
    })
  })

  it('lists favourites across every library, each with the poster its card shows', async () => {
    const entry = { media: mediaItem({ favourite: true }), poster: null }
    const { client, calls } = clientReturning(respond({ body: [entry] }))
    await expect(client.listFavourites()).resolves.toEqual([entry])
    expect(calls[0]?.url).toBe('http://nas:8484/api/favourites')
  })

  it('searches every library from home, a row for each holding a match', async () => {
    const shelf: HomeShelf = { libraryId: 3, type: 'media', media: [mediaItem()] }
    const { client, calls } = clientReturning(respond({ body: [shelf] }))
    await expect(client.searchHome(' heat ')).resolves.toEqual([shelf])
    expect(calls[0]?.url).toBe('http://nas:8484/api/home/search?q=heat')
  })

  it("asks for a library's videos in progress, favourites, sagas and files not matched", async () => {
    const entry = { media: mediaItem({ favourite: true }), poster: null }
    const saga = {
      tmdbId: '119',
      name: 'The Lord of the Rings Collection',
      backdrop: DEFAULT_SAGA_BACKDROP,
      media: [mediaItem()],
    }
    type AskedProps<T> = {
      body: Awaited<T>
      call: (client: ApiClient) => Promise<T>
    }

    const asked = async <T>({ body, call }: AskedProps<T>) => {
      const { client, calls } = clientReturning(respond({ body }))
      expect(await call(client)).toEqual(body)
      return calls[0]?.url
    }
    expect([
      await asked({ body: [entry], call: (client) => client.listInProgress(3) }),
      await asked({ body: [entry], call: (client) => client.listLibraryFavourites(3) }),
      await asked({ body: [saga], call: (client) => client.listSagas(3) }),
      await asked({
        body: [{ ...mediaItem(), aiSuggestion: null }],
        call: (client) => client.listUnmatched(3),
      }),
      await asked({
        body: { inProgress: 1, favourites: 2, sagas: 3, duplicates: 4, finished: 5 },
        call: (client) => client.getLibraryCounts(3),
      }),
    ]).toEqual([
      'http://nas:8484/api/libraries/3/in-progress',
      'http://nas:8484/api/libraries/3/favourites',
      'http://nas:8484/api/libraries/3/sagas',
      'http://nas:8484/api/libraries/3/unmatched',
      'http://nas:8484/api/libraries/3/counts',
    ])
  })

  it("lists a library's duplicates, splits a card and puts a movie back together", async () => {
    const entry = { media: mediaItem({ versions: 2 }), poster: null }
    const listing = [
      {
        itemId: 1,
        cards: [
          { entry, files: [{ media: mediaItem(), cut: { label: 'Final Cut', key: 'final' } }] },
        ],
      },
    ]
    const { client, calls } = clientReturning(respond({ body: listing }))
    await expect(client.listDuplicates(3)).resolves.toEqual(listing)
    await expect(
      client.splitDuplicate({ libraryId: 3, mediaId: 7, how: 'smart' }),
    ).resolves.toEqual(listing)
    await expect(client.joinSplit({ libraryId: 3, itemId: 1 })).resolves.toEqual(listing)
    expect(calls.map((call) => [call.url, call.init?.method, call.init?.body])).toEqual([
      ['http://nas:8484/api/libraries/3/duplicates', 'GET', undefined],
      [
        'http://nas:8484/api/libraries/3/duplicates/split',
        'POST',
        JSON.stringify({ mediaId: 7, how: 'smart' }),
      ],
      ['http://nas:8484/api/libraries/3/duplicates/join', 'POST', JSON.stringify({ itemId: 1 })],
    ])
  })

  it("picks a saga's backdrop, naming the saga in the path", async () => {
    const backdrop = { type: 'still', itemId: 20 } as const
    const { client, calls } = clientReturning(respond({ body: backdrop }))
    await expect(
      client.setSagaBackdrop({ libraryId: 3, sagaId: '119', backdrop }),
    ).resolves.toEqual(backdrop)
    expect(calls.map((call) => [call.url, call.init?.method, call.init?.body])).toEqual([
      ['http://nas:8484/api/libraries/3/sagas/119/backdrop', 'PUT', JSON.stringify(backdrop)],
    ])
  })

  it('reads and changes the display settings', async () => {
    const { client, calls } = clientReturning(respond({ body: { titles: 'text' } }))
    await expect(client.getDisplaySettings()).resolves.toEqual({ titles: 'text' })
    await expect(client.setDisplaySettings({ titles: 'text' })).resolves.toEqual({ titles: 'text' })
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['http://nas:8484/api/settings/display', 'GET'],
      ['http://nas:8484/api/settings/display', 'PUT'],
    ])
  })

  it('records that a video started playing', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.recordPlay(6)
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/media/6/plays',
      init: { method: 'POST' },
    })
  })

  it("lists a library's history, asking for as many as it wants", async () => {
    const entry = {
      media: mediaItem(),
      lastPlayedAt: '2026-10-10T19:00:00.000Z',
      plays: 1,
      furthest: 30,
      watched: false,
      marked: false,
    }
    const { client, calls } = clientReturning(respond({ body: [entry] }))
    await expect(client.listHistory({ libraryId: 3, limit: 50 })).resolves.toEqual([entry])
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/history?limit=50')
    await client.listHistory({ libraryId: 3, limit: 50, watchedOnly: true })
    expect(calls[1]?.url).toBe('http://nas:8484/api/libraries/3/history?limit=50&watched=true')
  })

  it("asks where a video's file lives", async () => {
    const { client, calls } = clientReturning(respond({ body: { path: '/media/Movies/a.mkv' } }))
    await expect(client.getMediaLocation(7)).resolves.toEqual({ path: '/media/Movies/a.mkv' })
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/location')
  })

  it('points an event source at the server', () => {
    const { client } = clientReturning(respond({}))
    expect(client.eventsUrl()).toBe('http://nas:8484/api/events')
  })

  it('reads the events it knows and drops the rest', () => {
    expect(parseServerEvent('{"type":"library","libraryId":2}')).toEqual({
      type: 'library',
      libraryId: 2,
    })
    expect(parseServerEvent('{"type":"party"}')).toBeNull()
    expect(parseServerEvent('not json')).toBeNull()
  })

  it('unlocks with a PIN, and locks again', async () => {
    const { client, calls } = clientReturning(
      respond({ body: { available: true, unlocked: true } }),
    )
    await expect(client.unlock('3001')).resolves.toEqual({ available: true, unlocked: true })
    expect(calls[0]?.url).toBe('http://nas:8484/api/lock/unlock')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ pin: '3001' }))
    await client.lock()
    expect(calls[1]?.url).toBe('http://nas:8484/api/lock/lock')
  })

  it('tells a locked library apart from other failures', async () => {
    const { client } = clientReturning(
      respond({ status: 423, body: { statusCode: 423, message: 'This library is locked.' } }),
    )
    const failure = await client.getMedia(7).catch((error: unknown) => error)
    expect(isLockedError(failure)).toBe(true)
    expect(isLockedError(new ApiError({ status: 403, message: 'No' }))).toBe(false)
  })

  it("tells Raven's unreachable server apart from the server's own 502", async () => {
    const unreachable = clientReturning(
      respond({ status: 502, body: { error: WEB_HOST_ERRORS.serverUnreachable } }),
    )
    const cut = await unreachable.client.getAuthConfig().catch((error: unknown) => error)
    expect(cut).toBeInstanceOf(ApiError)
    expect(cut).toMatchObject({ status: 502, isServerUnreachable: true })
    const broken = clientReturning(respond({ status: 502, body: { message: 'Bad gateway' } }))
    const failure = await broken.client.getAuthConfig().catch((error: unknown) => error)
    expect(failure).toMatchObject({ status: 502, isServerUnreachable: false })
    const funnel = clientReturning({
      ...respond({ status: 504 }),
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })
    const away = await funnel.client.getAuthConfig().catch((error: unknown) => error)
    expect(away).toMatchObject({ status: 504, isServerUnreachable: true })
  })

  it('deletes a video', async () => {
    const { client, calls } = clientReturning(respond({ status: 204 }))
    await client.deleteMedia(9)
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/media/9',
      init: { method: 'DELETE' },
    })
  })
})

describe('playback calls', () => {
  it('checks the track list against the contract', async () => {
    const tracks: MediaTracks = {
      audio: [
        { index: 0, codec: 'truehd', channels: 8, language: 'eng', title: null, default: true },
      ],
      subtitles: [
        {
          id: 'external-0',
          source: 'external',
          codec: 'srt',
          language: 'en',
          title: null,
          default: false,
          forced: true,
          hearingImpaired: false,
          supported: true,
        },
      ],
      defaultAudio: 0,
      frameRate: 23.976,
    }
    const { client, calls } = clientReturning(respond({ body: tracks }))
    await expect(client.getTracks(7)).resolves.toEqual(tracks)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/tracks')
    const { client: broken } = clientReturning(respond({ body: { audio: 'eng' } }))
    await expect(broken.getTracks(7)).rejects.toBeInstanceOf(ApiError)
  })

  it("fetches a file's streams and checks them", async () => {
    const streams: MediaStreams = {
      video: { codec: 'h264', profile: 'High', bitrate: 11_100_000, range: 'sdr' },
      audio: [
        {
          index: 0,
          codec: 'dts',
          profile: 'DTS-HD MA',
          channels: 6,
          bitrate: 1_509_000,
          sampleRate: 48_000,
        },
      ],
    }
    const { client, calls } = clientReturning(respond({ body: streams }))
    await expect(client.getStreams(7)).resolves.toEqual(streams)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/streams')
    const { client: broken } = clientReturning(
      respond({ body: { ...streams, video: { ...streams.video, range: 'hdr' } } }),
    )
    await expect(broken.getStreams(7)).rejects.toBeInstanceOf(ApiError)
  })

  it('fetches the media origins and checks them', async () => {
    const origins: MediaOrigin[] = [{ kind: 'lan', url: 'https://raven.home.example' }]
    const { client, calls } = clientReturning(respond({ body: { origins } }))
    await expect(client.getMediaOrigins()).resolves.toEqual({ origins })
    expect(calls[0]?.url).toBe('http://nas:8484/api/media-origins')
    const { client: broken } = clientReturning(respond({ body: { origins: [{ kind: 'moon' }] } }))
    await expect(broken.getMediaOrigins()).rejects.toMatchObject({ status: 502 })
  })

  it('fetches a media ticket and checks it', async () => {
    const ticket = { ticket: 'abc.def', expiresAt: 1_700_000_000_000 }
    const { client, calls } = clientReturning(respond({ body: ticket }))
    await expect(client.getMediaTicket(7)).resolves.toEqual(ticket)
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/ticket')
    const { client: broken } = clientReturning(respond({ body: { ticket: 'abc.def' } }))
    await expect(broken.getMediaTicket(7)).rejects.toMatchObject({ status: 502 })
  })

  it("points a speed probe at an origin's ping, a quarter of a MiB by default", () => {
    const { client } = clientReturning(respond({}))
    const origin: MediaOrigin = { kind: 'tailnet', url: 'https://raven.tail.ts.net' }
    expect(client.pingUrl({ origin })).toBe(
      `https://raven.tail.ts.net/api/media-origins/ping?bytes=${MEDIA_PROBE_BYTES}`,
    )
    expect(client.pingUrl({ origin, bytes: 1000 })).toBe(
      'https://raven.tail.ts.net/api/media-origins/ping?bytes=1000',
    )
  })

  it('fetches a subtitle window and parses it', async () => {
    const vtt = 'WEBVTT\n\n05:01.000 --> 05:02.000\nHello'
    const { client, calls } = clientReturning(respond({ body: vtt }))
    await expect(client.getSubtitles({ id: 7, trackId: 'embedded-2', window: 1 })).resolves.toEqual(
      [{ start: 301, end: 302, text: 'Hello' }],
    )
    expect(calls[0]?.url).toBe('http://nas:8484/api/media/7/subtitles/embedded-2?window=1')
  })

  it('fails a subtitle request with the server message', async () => {
    const { client } = clientReturning(
      respond({ status: 404, body: { statusCode: 404, message: 'No subtitle track x' } }),
    )
    await expect(client.getSubtitles({ id: 7, trackId: 'x' })).rejects.toThrow(
      'No subtitle track x',
    )
  })

  it('builds media URLs on the access origin with its ticket, and relative ones without', () => {
    const { client } = clientReturning(respond({}))
    const access = {
      origin: { kind: 'lan', url: 'https://raven.home.example' },
      ticket: 'abc.def',
    } as const satisfies MediaAccess
    expect(client.fileUrl({ id: 3, access })).toBe(
      'https://raven.home.example/api/media/3/file?t=abc.def',
    )
    expect(client.streamUrl({ id: 3, mode: 'remux', start: 0, audio: null, access })).toBe(
      'https://raven.home.example/api/media/3/stream?mode=remux&start=0&t=abc.def',
    )
    expect(client.streamUrl({ id: 3, mode: 'remux', start: 0, audio: 1, access })).toBe(
      'https://raven.home.example/api/media/3/stream?mode=remux&start=0&audio=1&t=abc.def',
    )
    expect(client.fileUrl({ id: 3, access: null })).toBe('http://nas:8484/api/media/3/file')
  })

  it('fetches subtitles from the access origin with the ticket', async () => {
    const vtt = 'WEBVTT\n\n05:01.000 --> 05:02.000\nHello'
    const { client, calls } = clientReturning(respond({ body: vtt }))
    const access = {
      origin: { kind: 'tailnet', url: 'https://raven.tail.example' },
      ticket: 'abc.def',
    } as const satisfies MediaAccess
    await client.getSubtitles({ id: 7, trackId: 'embedded-2', window: 1, access })
    expect(calls[0]?.url).toBe(
      'https://raven.tail.example/api/media/7/subtitles/embedded-2?window=1&t=abc.def',
    )
  })

  it('builds HLS master URLs on the access origin, and relative ones without', () => {
    const { client } = clientReturning(respond({}))
    const access = {
      origin: { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://nas.local:8443' },
      ticket: 'abc',
    } as const satisfies MediaAccess
    expect(
      client.hlsUrl({ id: 7, mode: PLAYBACK_MODES.remux, audio: 1, quality: null, access }),
    ).toBe('https://nas.local:8443/api/media/7/hls/master.m3u8?mode=remux&audio=1&t=abc')
    expect(
      client.hlsUrl({
        id: 7,
        mode: PLAYBACK_MODES.transcode,
        audio: null,
        quality: 'low720',
        access: null,
      }),
    ).toBe('http://nas:8484/api/media/7/hls/master.m3u8?mode=transcode&quality=low720')
  })

  it('builds stream URLs', () => {
    const { client } = clientReturning(respond({}))
    expect(client.streamUrl({ id: 7, mode: 'remux', start: 61.23456, audio: 2 })).toBe(
      'http://nas:8484/api/media/7/stream?mode=remux&start=61.235&audio=2',
    )
    expect(client.streamUrl({ id: 7, mode: 'transcode', start: -3, audio: null })).toBe(
      'http://nas:8484/api/media/7/stream?mode=transcode&start=0',
    )
  })
})

describe('the metadata calls', () => {
  it('fetches an item and checks it against the contract', async () => {
    const details = itemDetails()
    const { client, calls } = clientReturning(respond({ body: details }))
    await expect(client.getItem(1)).resolves.toEqual(details)
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/1')
  })

  it('searches TMDB through the server with the year when there is one', async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await client.searchMatches({ type: 'movie', query: ' The Matrix ', year: 1999 })
    expect(calls[0]?.url).toBe(
      'http://nas:8484/api/match/search?type=movie&query=The%20Matrix&year=1999',
    )
  })

  it("names the library a search is for, so its type's results come first", async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await client.searchMatches({ type: 'show', query: 'Cowboy Bebop', year: null, libraryId: 3 })
    expect(calls[0]?.url).toBe(
      'http://nas:8484/api/match/search?type=show&query=Cowboy%20Bebop&libraryId=3',
    )
  })

  it('names the file or show a search is for, so it can be scored against what is on disk', async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await client.searchMatches({
      type: 'show',
      query: 'Monster',
      subject: { kind: 'media', id: 12 },
    })
    await client.searchMatches({
      type: 'show',
      query: 'Monster',
      subject: { kind: 'item', id: 40 },
    })
    expect(calls.map((call) => call.url)).toEqual([
      'http://nas:8484/api/match/search?type=show&query=Monster&mediaId=12',
      'http://nas:8484/api/match/search?type=show&query=Monster&itemId=40',
    ])
  })

  it('saves a match, or the lack of one', async () => {
    const { client, calls } = clientReturning(respond({ body: mediaItem() }))
    await client.setMatch({ mediaId: 7, tmdbId: null })
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/media/7/match',
      init: { method: 'PUT', body: '{"tmdbId":null}' },
    })
  })

  it('lists a TV library as shows, with the search and sort', async () => {
    const listing = { shows: [showEntry()], unmatched: [] }
    const { client, calls } = clientReturning(respond({ body: listing }))
    await expect(client.listShows({ libraryId: 3, search: 'sev', sort: 'added' })).resolves.toEqual(
      listing,
    )
    expect(calls[0]?.url).toBe('http://nas:8484/api/libraries/3/shows?sort=added&q=sev')
  })

  it('fetches a person and builds avatar URLs', async () => {
    const person: PersonDetails = {
      id: 5,
      tmdbId: '6384',
      name: 'Keanu Reeves',
      photoVersion: 'k',
      profile: null,
      filmography: { state: 'unavailable' },
      credits: [{ item: itemSummary(), job: 'cast', role: 'Neo' }],
    }
    const { client, calls } = clientReturning(respond({ body: person }))
    await expect(client.getPerson(5)).resolves.toEqual(person)
    expect(calls[0]?.url).toBe('http://nas:8484/api/people/5')
    expect(client.reviewAvatarUrl({ reviewId: 3, avatarVersion: 'a1' })).toBe(
      'http://nas:8484/api/reviews/3/avatar?v=a1',
    )
    expect(client.reviewAvatarUrl({ reviewId: 3, avatarVersion: null })).toBeNull()
  })

  it('asks for the next episode of a show, which may be none', async () => {
    const { client, calls } = clientReturning(respond({ body: null }))
    await expect(client.nextEpisode(4)).resolves.toBeNull()
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/4/next')
  })

  it('asks for the episodes of a show or a season in a random order, which may be none', async () => {
    const { client, calls } = clientReturning(respond({ body: [] }))
    await expect(client.shuffleEpisodes(5)).resolves.toEqual([])
    expect(calls[0]?.url).toBe('http://nas:8484/api/items/5/shuffle')
  })

  it("re-points a show's files", async () => {
    const { client, calls } = clientReturning(respond({ body: itemDetails() }))
    await client.setItemMatch({ itemId: 4, tmdbId: '95396' })
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/items/4/match',
      init: { method: 'PUT', body: '{"tmdbId":"95396"}' },
    })
  })

  it('posts a refresh', async () => {
    const { client, calls } = clientReturning(respond({ body: itemDetails() }))
    await client.refreshItem(4)
    expect(calls[0]).toMatchObject({
      url: 'http://nas:8484/api/items/4/refresh',
      init: { method: 'POST' },
    })
  })

  it('reads the metadata part of the health check', async () => {
    const metadata: MetadataHealth = {
      tmdb: 'ok',
      omdb: 'off',
      mdblist: 'off',
      pending: 3,
      error: null,
      lastOk: null,
      ai: 'ok',
      aiRemaining: 200,
      aiPending: 1,
    }
    const health = {
      status: 'ok',
      ffmpeg: '7.1',
      tonemap: true,
      encoder: 'software',
      thumbnailsPending: 0,
      metadata,
    }
    const { client } = clientReturning(respond({ body: health }))
    await expect(client.getMetadataHealth()).resolves.toEqual(metadata)
  })

  it('refuses a health check it does not understand', async () => {
    const metadata = { tmdb: 'ok', omdb: 'off', pending: 3, error: null, lastOk: null }
    const { client } = clientReturning(respond({ body: { status: 'ok', metadata } }))
    await expect(client.getMetadataHealth()).rejects.toMatchObject({ status: 502 })
  })

  it('builds versioned image URLs, and none without a version', () => {
    const { client } = clientReturning(respond({}))
    expect(client.itemImageUrl({ id: 2, kind: 'poster', version: 'abc' })).toBe(
      'http://nas:8484/api/pictures/items/2/poster/abc',
    )
    expect(client.itemImageUrl({ id: 2, kind: 'backdrop', version: null })).toBeNull()
    expect(client.libraryBackdropUrl({ type: 'item', id: 3, version: 'def' })).toBe(
      'http://nas:8484/api/pictures/items/3/backdrop/def',
    )
    expect(client.libraryBackdropUrl({ type: 'thumbnail', id: 8, version: 41 })).toBe(
      'http://nas:8484/api/media/8/thumbnail?v=41',
    )
    expect(client.sagaPictureUrl({ id: 4, version: 'ghi', title: 'Sintel' })).toBe(
      'http://nas:8484/api/pictures/items/4/backdrop/ghi',
    )
    expect(client.photoUrl({ personId: 5, photoVersion: 'x' })).toBe(
      'http://nas:8484/api/pictures/people/5/x',
    )
    expect(client.candidatePosterUrl('/abc.jpg')).toBe('http://nas:8484/api/images/poster/abc.jpg')
  })

  it('lists a TMDB poster at each width, the middle as its src and the widest at its own URL', () => {
    const { client } = clientReturning(respond({}))
    expect(client.tmdbPosterSources('/abc.jpg').srcSet).toContain(
      `${client.candidatePosterUrl('/abc.jpg')} 500w`,
    )
    expect(client.tmdbPosterSources('/abc.jpg')).toEqual({
      src: 'http://nas:8484/api/images/poster/abc.jpg?w=342',
      srcSet: [
        'http://nas:8484/api/images/poster/abc.jpg?w=185 185w',
        'http://nas:8484/api/images/poster/abc.jpg?w=342 342w',
        'http://nas:8484/api/images/poster/abc.jpg 500w',
      ].join(', '),
    })
  })

  it("lists a poster at each of its widths, the widest at the poster's own URL", () => {
    const { client } = clientReturning(respond({}))
    expect(client.posterSrcSet({ id: 2, version: 'abc' })).toBe(
      [
        'http://nas:8484/api/pictures/items/2/poster/abc?w=185 185w',
        'http://nas:8484/api/pictures/items/2/poster/abc?w=342 342w',
        'http://nas:8484/api/pictures/items/2/poster/abc 500w',
      ].join(', '),
    )
    expect(client.posterSrcSet({ id: 2, version: null })).toBeNull()
    expect(client.backdropSrcSet({ id: 2, version: 'abc' })).toBeNull()
  })

  describe('through an image CDN', () => {
    const client = createApiClient({
      fetch: async () => respond({}),
      pictureCdn: '/.netlify/images',
    })
    type AtProps = { path: string; width?: number }

    const at = ({ path, width }: AtProps): string =>
      `/.netlify/images?url=${encodeURIComponent(path)}${width === undefined ? '' : `&w=${width}`}`

    it('sends every capability picture through it, at its own width', () => {
      expect(client.itemImageUrl({ id: 2, kind: 'poster', version: 'abc' })).toBe(
        at({ path: '/api/pictures/items/2/poster/abc' }),
      )
      expect(client.photoUrl({ personId: 5, photoVersion: 'x' })).toBe(
        at({ path: '/api/pictures/people/5/x' }),
      )
    })

    it('leaves the pictures only an account may see on the server', () => {
      expect(client.libraryBackdropUrl({ type: 'thumbnail', id: 8, version: 41 })).toBe(
        '/api/media/8/thumbnail?v=41',
      )
      expect(client.candidatePosterUrl('/abc.jpg')).toBe('/api/images/poster/abc.jpg')
    })

    it('lists a poster at each of its finer widths, the widest at its own URL', () => {
      const path = '/api/pictures/items/2/poster/abc'
      expect(client.posterWidths).toEqual(CDN_POSTER_WIDTHS)
      expect(client.posterSrcSet({ id: 2, version: 'abc' })).toBe(
        CDN_POSTER_WIDTHS.map(
          (width) => `${at(width === POSTER_OWN_WIDTH ? { path } : { path, width })} ${width}w`,
        ).join(', '),
      )
    })

    it('lists a backdrop at each width, the widest at its own URL', () => {
      const path = '/api/pictures/items/3/backdrop/def'
      expect(client.backdropSrcSet({ id: 3, version: 'def' })).toBe(
        CDN_BACKDROP_WIDTHS.map(
          (width) => `${at(width === BACKDROP_OWN_WIDTH ? { path } : { path, width })} ${width}w`,
        ).join(', '),
      )
      expect(client.backdropSrcSet({ id: 3, version: null })).toBeNull()
    })
  })
})

describe('the bug report calls', () => {
  it('posts the diagnostics as they are, and reads back the report it made', async () => {
    const diagnostics = playbackDiagnostics()
    const report = bugReport({ diagnostics })
    const { client, calls } = clientReturning(respond({ status: 201, body: report }))
    expect(await client.reportPlaybackError(diagnostics)).toEqual(report)
    expect(calls[0]?.url ?? null).toBe('http://nas:8484/api/reports')
    expect(calls[0]?.init?.method ?? null).toBe('POST')
    expect(calls[0]?.init?.body ?? null).toBe(JSON.stringify(diagnostics))
  })

  it('lists the reports, refusing a list it does not understand', async () => {
    const listed = clientReturning(respond({ body: [bugReport()] }))
    expect(await listed.client.listBugReports()).toEqual([bugReport()])
    expect(listed.calls[0]?.url ?? null).toBe('http://nas:8484/api/reports')
    const bad = clientReturning(respond({ body: [{ id: 1 }] }))
    await expect(bad.client.listBugReports()).rejects.toMatchObject({ status: 502 })
  })

  it('puts a new status on the report its id names', async () => {
    const fixed = bugReport({ id: 4, status: BUG_REPORT_STATUSES.fixed })
    const { client, calls } = clientReturning(respond({ body: fixed }))
    expect(await client.setBugReportStatus({ id: 4, status: BUG_REPORT_STATUSES.fixed })).toEqual(
      fixed,
    )
    expect(calls[0]?.url ?? null).toBe('http://nas:8484/api/reports/4/status')
    expect(calls[0]?.init?.method ?? null).toBe('PUT')
    expect(calls[0]?.init?.body ?? null).toBe(JSON.stringify({ status: BUG_REPORT_STATUSES.fixed }))
  })
})
