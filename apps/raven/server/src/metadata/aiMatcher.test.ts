import { join } from 'node:path'
import { DEFAULT_LIBRARY_SETTINGS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import type { LibraryRecord } from '@/libraries/librariesRepository'
import { AiClient, AiError } from '@/metadata/aiClient'
import { aiGroupOf, AiMatcher } from '@/metadata/aiMatcher'
import { type AiGroup, AI_TOOL_NAMES } from '@/metadata/aiTools'
import type { MatchFile } from '@/metadata/matchFiles'
import { TmdbClient, TmdbError } from '@/metadata/tmdbClient'
import { type FakeReply, fakeClaude } from '@/test/fakeClaude'
import { fakeTmdb } from '@/test/fakeTmdb'

const config = {
  ...readServerConfig({}),
  tmdbApiToken: 'test-token',
  anthropicApiKey: 'test-key',
}

const WILD: AiGroup = {
  kind: 'shows',
  type: 'show',
  layout: 'flat',
  place: 'Destination Wild Arctic',
  fileCount: 2,
  fileNames: [
    'Season 1/Destination Wild Arctic - S01E01 - Polar Night.mp4',
    'Season 1/Destination Wild Arctic - S01E02 - The Thaw.mp4',
  ],
  parsed: { title: 'Destination Wild Arctic', year: null },
  tried: [{ title: 'Destination Wild Arctic', year: null }],
}

const SEARCH_WILD: FakeReply = { kind: 'search', type: 'show', query: 'Wild Arctic', year: null }

describe('AiMatcher', () => {
  const tmdb = fakeTmdb({
    movies: [{ id: 949, title: 'Heat', released: '1995-12-15' }],
    shows: [
      {
        id: 80001,
        title: 'Wild Arctic',
        first: '2018-01-07',
        genreIds: [99],
        countries: ['GB'],
        seasons: {
          1: [
            { number: 1, title: 'Polar Night', aired: '2018-01-07' },
            { number: 2, title: 'The Thaw', aired: '2018-01-14' },
          ],
        },
      },
    ],
  })

  const lookUp = async ({
    replies,
    status = 200,
  }: {
    replies: readonly FakeReply[]
    status?: number
  }) => {
    const claude = fakeClaude({ lookups: { [WILD.place]: replies } })
    claude.state.status = status
    const matcher = new AiMatcher(
      config,
      new AiClient(config, claude.fetch),
      new TmdbClient(config, tmdb.fetch),
    )
    const outcome = await matcher.decide(WILD)
    return { outcome, requests: claude.state.requests }
  }

  /** The tool results raven sent back on a request: its last message's content. */
  const resultsIn = (body: Record<string, unknown>): unknown =>
    (Array.isArray(body.messages) ? body.messages : []).at(-1)

  it('takes a show it checked episode by episode as a sure pick', async () => {
    const { outcome, requests } = await lookUp({
      replies: [
        SEARCH_WILD,
        { kind: 'episodes', tmdbId: '80001', season: 1 },
        {
          kind: 'choose',
          tmdbId: '80001',
          confidence: 'high',
          reason: "Season 1's episode titles match TMDB's.",
        },
      ],
    })
    expect(outcome).toEqual({
      kind: 'chosen',
      pick: { tmdbId: '80001', title: 'Wild Arctic', year: 2018, poster: '/showposter80001.jpg' },
      confidence: 'high',
      reason: "Season 1's episode titles match TMDB's.",
    })
    expect(requests).toHaveLength(3)
  })

  it('keeps a pick it could not confirm as unsure', async () => {
    const { outcome } = await lookUp({
      replies: [
        SEARCH_WILD,
        { kind: 'choose', tmdbId: '80001', confidence: 'low', reason: 'Generic titles.' },
      ],
    })
    expect(outcome).toMatchObject({ kind: 'chosen', confidence: 'low' })
  })

  it('chooses nothing when no result fits', async () => {
    const { outcome } = await lookUp({
      replies: [
        { kind: 'search', type: 'show', query: 'Cesar 911', year: null },
        { kind: 'choose', tmdbId: null, confidence: 'high', reason: 'No TMDB show fits.' },
      ],
    })
    expect(outcome).toEqual({ kind: 'none', confidence: 'high', reason: 'No TMDB show fits.' })
  })

  it('throws away an id no search in the lookup returned', async () => {
    const { outcome } = await lookUp({
      replies: [{ kind: 'choose', tmdbId: '80001', confidence: 'high', reason: 'I know it.' }],
    })
    expect(outcome).toMatchObject({ kind: 'undecided' })
  })

  it('throws away a movie id in a TV library, though a search returned it', async () => {
    const { outcome } = await lookUp({
      replies: [
        { kind: 'search', type: 'movie', query: 'Heat', year: null },
        { kind: 'choose', tmdbId: '949', confidence: 'high', reason: 'Heat.' },
      ],
    })
    expect(outcome).toMatchObject({ kind: 'undecided' })
  })

  it('can choose a TV documentary offered as a movie, preserving its source id', async () => {
    const group: AiGroup = { ...WILD, kind: 'documentaries', type: 'movie' }
    const claude = fakeClaude({
      lookups: {
        [group.place]: [
          { kind: 'search', type: 'movie', query: 'Wild Arctic', year: null },
          {
            kind: 'choose',
            tmdbId: 'tv:80001',
            confidence: 'low',
            reason: 'TV documentary released as one movie.',
          },
        ],
      },
    })
    const matcher = new AiMatcher(
      config,
      new AiClient(config, claude.fetch),
      new TmdbClient(config, tmdb.fetch),
    )
    expect(await matcher.decide(group)).toMatchObject({
      kind: 'chosen',
      pick: { tmdbId: 'tv:80001', title: 'Wild Arctic' },
      confidence: 'low',
    })
  })

  it('takes a refusal as no decision', async () => {
    const { outcome, requests } = await lookUp({ replies: [{ kind: 'refuse' }] })
    expect(outcome).toMatchObject({ kind: 'undecided' })
    expect(requests).toHaveLength(1)
  })

  it('takes an end without choose_match as no decision', async () => {
    const { outcome } = await lookUp({
      replies: [SEARCH_WILD, { kind: 'say', text: 'Wild Arctic, I think.' }],
    })
    expect(outcome).toMatchObject({ kind: 'undecided' })
  })

  it('gives up after six replies without a choice', async () => {
    const { outcome, requests } = await lookUp({
      replies: Array.from({ length: 7 }, () => SEARCH_WILD),
    })
    expect(outcome).toEqual({ kind: 'undecided', reason: 'No choice in 6 turns.' })
    expect(requests).toHaveLength(6)
  })

  it('tells Claude, after the tool results, when its next reply is its last', async () => {
    const { requests } = await lookUp({ replies: Array.from({ length: 7 }, () => SEARCH_WILD) })
    const notice = 'This is your last reply: call choose_match now.'
    expect(requests.map((request) => request.raw.includes(notice))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ])
    expect(resultsIn(requests[5]!.body)).toEqual({
      role: 'user',
      content: [
        expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_4' }),
        { type: 'text', text: notice },
      ],
    })
  })

  it('describes each result by id, titles, year, genres, language, countries and the start of its overview', async () => {
    const { requests } = await lookUp({
      replies: [SEARCH_WILD, { kind: 'choose', tmdbId: null, confidence: 'low', reason: 'x' }],
    })
    expect(resultsIn(requests[1]!.body)).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_0',
          content: JSON.stringify([
            {
              tmdbId: '80001',
              title: 'Wild Arctic',
              originalTitle: 'Wild Arctic',
              year: 2018,
              genres: ['Documentary'],
              language: 'en',
              countries: ['GB'],
              overview: 'Wild Arctic is a show.',
            },
          ]),
        },
      ],
    })
  })

  it("lists a season's episodes, says when TMDB has no such season, and lists only shows it offered", async () => {
    const { requests } = await lookUp({
      replies: [
        { kind: 'episodes', tmdbId: '80001', season: 1 },
        SEARCH_WILD,
        { kind: 'episodes', tmdbId: '80001', season: 2 },
        { kind: 'episodes', tmdbId: '80001', season: 1 },
        { kind: 'choose', tmdbId: null, confidence: 'low', reason: 'x' },
      ],
    })
    expect(resultsIn(requests[1]!.body)).toMatchObject({
      content: [
        {
          content: 'Show 80001 came from no search in this lookup; search for it first.',
          is_error: true,
        },
      ],
    })
    expect(resultsIn(requests[3]!.body)).toMatchObject({
      content: [{ content: 'TMDB lists no season 2 of show 80001.' }],
    })
    expect(resultsIn(requests[4]!.body)).toMatchObject({
      content: [
        {
          content: JSON.stringify({
            season: 1,
            episodes: [
              { number: 1, title: 'Polar Night' },
              { number: 2, title: 'The Thaw' },
            ],
          }),
        },
      ],
    })
  })

  it('refuses a tool call whose input does not fit, or a tool there is not', async () => {
    const { requests } = await lookUp({
      replies: [
        {
          kind: 'call',
          name: AI_TOOL_NAMES.search,
          input: { type: 'show', query: ' ', year: null },
        },
        { kind: 'call', name: 'delete_files', input: {} },
        { kind: 'choose', tmdbId: null, confidence: 'low', reason: 'x' },
      ],
    })
    expect(resultsIn(requests[1]!.body)).toMatchObject({ content: [{ is_error: true }] })
    expect(resultsIn(requests[2]!.body)).toMatchObject({
      content: [{ content: 'There is no tool called delete_files.', is_error: true }],
    })
  })

  it('refuses a year, a season or a title out of bounds, and never asks TMDB with it', async () => {
    const { requests } = await lookUp({
      replies: [
        {
          kind: 'call',
          name: AI_TOOL_NAMES.search,
          input: { type: 'show', query: 'Wild Arctic', year: 1869 },
        },
        {
          kind: 'call',
          name: AI_TOOL_NAMES.search,
          input: { type: 'show', query: 'W'.repeat(201), year: null },
        },
        SEARCH_WILD,
        { kind: 'call', name: AI_TOOL_NAMES.episodes, input: { tmdbId: '80001', season: 1000 } },
        { kind: 'choose', tmdbId: null, confidence: 'low', reason: 'x' },
      ],
    })
    const searchError =
      'search_tmdb takes a type, a title of at most 200 characters, and a year from 1870 to 2100 or null.'
    expect([1, 2, 4].map((index) => resultsIn(requests[index]!.body))).toEqual([
      {
        role: 'user',
        content: [expect.objectContaining({ content: searchError, is_error: true })],
      },
      {
        role: 'user',
        content: [expect.objectContaining({ content: searchError, is_error: true })],
      },
      {
        role: 'user',
        content: [
          expect.objectContaining({
            content: 'list_episodes takes a show id and a season number from 0 to 999.',
            is_error: true,
          }),
        ],
      },
    ])
    expect(tmdb.state.calls.filter((url) => /1869|WWWW|season\/1000/.test(url))).toEqual([])
  })

  it('asks as the spec sets: the model, low effort, adaptive thinking, strict tools, the prompt cached', async () => {
    const { requests } = await lookUp({ replies: [{ kind: 'refuse' }] })
    const [first] = requests
    expect(first?.apiKey).toBe('test-key')
    expect(first?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      tool_choice: { type: 'auto' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
      tools: [
        { name: 'search_tmdb', strict: true, input_schema: { additionalProperties: false } },
        { name: 'list_episodes', strict: true, input_schema: { additionalProperties: false } },
        { name: 'choose_match', strict: true, input_schema: { additionalProperties: false } },
      ],
    })
    // Each of these is a 400 on Haiku 5.5, and none belongs in a lookup.
    expect(first?.raw).not.toMatch(/budget_tokens|top_p|top_k|temperature|fallbacks/)
    expect(first?.body.messages).toEqual([
      { role: 'user', content: expect.stringMatching(/^Which TMDB show are these files\?\n\n\{/) },
    ])
  })

  it('keeps the conversation append-only, sending each reply back as it came, thinking and all', async () => {
    const { requests } = await lookUp({
      replies: [
        SEARCH_WILD,
        { kind: 'episodes', tmdbId: '80001', season: 1 },
        { kind: 'choose', tmdbId: '80001', confidence: 'high', reason: 'Titles match.' },
      ],
    })
    const messages = requests.map((request) =>
      Array.isArray(request.body.messages) ? request.body.messages : [],
    )
    expect(messages.map((each) => each.length)).toEqual([1, 3, 5])
    expect(messages[1]?.slice(0, 1)).toEqual(messages[0])
    expect(messages[2]?.slice(0, 3)).toEqual(messages[1])
    expect(messages[1]?.[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'signature-0' },
        {
          type: 'tool_use',
          id: 'toolu_0',
          name: 'search_tmdb',
          input: { type: 'show', query: 'Wild Arctic', year: null },
          caller: { type: 'direct' },
        },
      ],
    })
  })

  it('throws when TMDB is away, leaving the group to be asked again', async () => {
    tmdb.state.down = true
    try {
      await expect(lookUp({ replies: [SEARCH_WILD] })).rejects.toBeInstanceOf(TmdbError)
    } finally {
      tmdb.state.down = false
    }
  })

  it('throws when TMDB is away listing a season, rather than saying there is no such season', async () => {
    tmdb.state.failing.push('/tv/80001/season')
    try {
      const looking = lookUp({
        replies: [
          SEARCH_WILD,
          { kind: 'episodes', tmdbId: '80001', season: 1 },
          { kind: 'choose', tmdbId: '80001', confidence: 'high', reason: 'Titles match.' },
        ],
      })
      await expect(looking).rejects.toBeInstanceOf(TmdbError)
    } finally {
      tmdb.state.failing.splice(0)
    }
  })

  it('throws when Anthropic is away', async () => {
    await expect(lookUp({ replies: [SEARCH_WILD], status: 529 })).rejects.toBeInstanceOf(AiError)
  })
})

describe('aiGroupOf', () => {
  const library = (kind: LibraryRecord['settings']['kind']): LibraryRecord => ({
    id: 1,
    name: 'TV',
    paths: ['/media/TV'],
    layouts: [{ path: '/media/TV', layout: 'lettered', groups: 0 }],
    itemCount: 0,
    unmatchedCount: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    settings: { ...DEFAULT_LIBRARY_SETTINGS, kind },
  })
  const file = ({
    id,
    folder,
    fileName,
    title = '',
    year = null,
  }: {
    id: number
    folder: string
    fileName: string
    title?: string
    year?: number | null
  }): MatchFile => ({
    id,
    libraryId: 1,
    path: join('/media/TV/D', folder, fileName),
    fileName,
    folder,
    title,
    year,
    match: 'unmatched',
  })

  it('describes a show folder by its place and 12 files spread over it, never a full path', () => {
    const files = [1, 2, 3].flatMap((season) =>
      Array.from({ length: 10 }, (_, index) => {
        const code = `S0${season}E${String(index + 1).padStart(2, '0')}`
        return file({
          id: season * 100 + index,
          folder: `Doctor Who (2023)/Season ${season}`,
          fileName: `Doctor Who - ${code} - Episode ${index + 1}.mkv`,
        })
      }),
    )
    const group = aiGroupOf({
      library: library('shows'),
      type: 'show',
      place: 'Doctor Who (2023)',
      files: files.toReversed(),
    })
    expect(group).toMatchObject({
      kind: 'shows',
      type: 'show',
      layout: 'lettered',
      place: 'Doctor Who (2023)',
      fileCount: 30,
      parsed: { title: 'Doctor Who', year: 2023 },
      tried: [{ title: 'Doctor Who', year: 2023 }],
    })
    expect(group.fileNames).toHaveLength(12)
    expect(group.fileNames[0]).toBe('Season 1/Doctor Who - S01E01 - Episode 1.mkv')
    expect(group.fileNames.at(-1)).toMatch(/^Season 3\//)
    expect(JSON.stringify(group)).not.toContain('/media')
  })

  it('describes a movie by its file, the title its name reads and the searches tried', () => {
    const movie = file({
      id: 1,
      folder: '25th Hour (2002)',
      fileName: '25th.Hour.2002.1080p.mkv',
      title: '25th Hour',
      year: 2002,
    })
    const group = aiGroupOf({
      library: library('movies'),
      type: 'movie',
      place: '25th Hour (2002)',
      files: [movie],
    })
    expect(group).toMatchObject({
      type: 'movie',
      fileCount: 1,
      fileNames: ['25th.Hour.2002.1080p.mkv'],
      parsed: { title: '25th Hour', year: 2002 },
    })
    expect(group.tried[0]).toEqual({ title: '25th Hour', year: 2002 })
  })
})
