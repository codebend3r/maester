import { relative } from 'node:path'
import type { Anthropic } from '@anthropic-ai/sdk'
import { Inject, Injectable } from '@nestjs/common'
import { ITEM_TYPES, type MatchItemType, parseMovieName } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import type { LibraryRecord } from '@/libraries/librariesRepository'
import { AiClient } from '@/metadata/aiClient'
import { AI_OUTCOME_KINDS, type AiOutcome, type AiPick } from '@/metadata/aiDecisions'
import {
  AI_INPUT_BOUNDS,
  AI_SEARCH_RESULTS,
  AI_SYSTEM_PROMPT,
  AI_TOOL_NAMES,
  AI_TOOLS,
  type AiGroup,
  askFor,
  describeCandidate,
  isChooseInput,
  isEpisodesInput,
  isSearchInput,
} from '@/metadata/aiTools'
import type { MatchFile } from '@/metadata/matchFiles'
import { movieSearchTitles, readShowFile, showSearchTitles } from '@/metadata/matchers'
import { notFound } from '@/metadata/matchPass'
import { filePlace } from '@/metadata/places'
import { TmdbClient } from '@/metadata/tmdbClient'
import type { SearchResult } from '@/metadata/tmdbShapes'

/** The reasons a turn stops that it tells apart. */
export const STOP_REASONS = {
  endTurn: 'end_turn',
  refusal: 'refusal',
  toolUse: 'tool_use',
} as const satisfies Record<string, NonNullable<Anthropic.Message['stop_reason']>>

/** The content block a tool call comes in. */
const BLOCK_TYPES = { toolUse: 'tool_use' } as const satisfies Record<
  string,
  Anthropic.Message['content'][number]['type']
>

/** How many file names a lookup is sent, spread over the group. */
const AI_FILE_SAMPLE = 12

/** How many groups are asked about at once. */
export const AI_CONCURRENCY = 2

/** Replies Claude gets to choose in; past the last, the lookup has no decision. */
const AI_MAX_TURNS = 6

/** Room for one reply's thinking and its tool calls. */
const MAX_TOKENS = 4000

/** The longest reason kept, in characters. */
const REASON_LENGTH = 500

/** Sent with the tool results before Claude's last reply, so it chooses rather than runs out. */
const LAST_REPLY: Anthropic.TextBlockParam = {
  type: 'text',
  text: 'This is your last reply: call choose_match now.',
}

const { years, seasons, queryLength } = AI_INPUT_BOUNDS

type SpreadProps<T> = { items: readonly T[]; count: number }

/** `count` of `items`, evenly spaced from the first, so a long show is sampled over every season. */
const spread = <T>({ items, count }: SpreadProps<T>): T[] =>
  items.length <= count
    ? [...items]
    : Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)])

type InPlaceProps = { place: string; file: MatchFile }

/** A file's path inside its group's place; a loose file is its own place, so its name. */
const inPlace = ({ place, file }: InPlaceProps): string =>
  relative(place, filePlace(file)) || file.fileName

/** Searches as Claude is told of them: the title and year, without the country a search narrows by. */
const plainTitles = (
  titles: ReadonlyArray<{ title: string; year: number | null }>,
): AiGroup['tried'] => titles.map(({ title, year }) => ({ title, year }))

type ReadingOfProps = {
  type: MatchItemType
  first: MatchFile
}

/** What matching read from a group's first file, and the searches it ran with it. */
const readingOf = ({ type, first }: ReadingOfProps): Pick<AiGroup, 'parsed' | 'tried'> => {
  if (type === ITEM_TYPES.show) {
    const parsed = readShowFile(first)
    return {
      parsed: { title: parsed.show, year: parsed.year },
      tried: plainTitles(showSearchTitles(parsed)),
    }
  }
  return {
    parsed: { title: first.title, year: first.year },
    tried: plainTitles(movieSearchTitles({ file: first, parsed: parseMovieName(first) })),
  }
}

type AiGroupOfProps = {
  library: LibraryRecord
  type: MatchItemType
  place: string
  files: readonly MatchFile[]
}

/**
 * A group left unmatched, as one lookup describes it: the library's type,
 * how its path was read, the group's place, some of its files as paths
 * inside the place, and what matching read and searched. Nothing in it is a
 * path outside the library.
 */
export const aiGroupOf = ({ library, type, place, files }: AiGroupOfProps): AiGroup => {
  const ordered = files.toSorted((a, b) => filePlace(a).localeCompare(filePlace(b)))
  const [first] = ordered
  if (first == null) throw new Error(`No files to look up for "${place}"`)
  return {
    kind: library.settings.kind,
    type,
    layout:
      library.layouts.find((entry) => first.path.startsWith(`${entry.path}/`))?.layout ?? null,
    place,
    fileCount: ordered.length,
    fileNames: spread({ items: ordered, count: AI_FILE_SAMPLE }).map((file) =>
      inPlace({ place, file }),
    ),
    ...readingOf({ type, first }),
  }
}

/** One lookup's own state: what `search_tmdb` offered, by type and id. */
type Lookup = { group: AiGroup; offered: Map<string, AiPick> }

type OfferedKeyProps = { type: MatchItemType; tmdbId: string }

/** TMDB's movie and show ids overlap, so an offer is known by both. */
const offeredKey = ({ type, tmdbId }: OfferedKeyProps): string => `${type}:${tmdbId}`

const undecided = (reason: string): AiOutcome => ({ kind: AI_OUTCOME_KINDS.undecided, reason })

type AnswerProps = {
  use: Anthropic.ToolUseBlock
  content: string
  isError?: boolean
}

const answer = ({
  use,
  content,
  isError = false,
}: AnswerProps): Anthropic.ToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: use.id,
  content,
  ...(isError ? { is_error: true } : {}),
})

const pickOf = (result: SearchResult): AiPick => ({
  tmdbId: result.tmdbId,
  title: result.title,
  year: result.year,
  poster: result.poster,
})

type AiMatcherTurnProps = {
  lookup: Lookup
  messages: readonly Anthropic.MessageParam[]
  turn: number
}

type AiMatcherRunProps = {
  lookup: Lookup
  use: Anthropic.ToolUseBlock
}

type AiMatcherSearchProps = {
  lookup: Lookup
  use: Anthropic.ToolUseBlock
}

type AiMatcherEpisodesProps = {
  lookup: Lookup
  use: Anthropic.ToolUseBlock
}

type AiMatcherChooseProps = { lookup: Lookup; input: unknown }

/**
 * The AI lookup for one group: Claude searches TMDB and lists seasons with
 * the tools until it calls `choose_match`, in at most six replies. Each
 * reply goes back into the conversation whole and unchanged, thinking
 * blocks included, and the conversation only ever grows.
 */
@Injectable()
export class AiMatcher {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AiClient) private readonly ai: AiClient,
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
  ) {}

  /** The model lookups ask, kept beside each decision. */
  get model(): string {
    return this.config.aiMatchModel
  }

  /**
   * Which TMDB movie or show `group` is, as Claude decides it. Anthropic
   * failing throws an `AiError`, and TMDB failing a `TmdbError`; either
   * leaves the group to be asked again.
   */
  decide(group: AiGroup): Promise<AiOutcome> {
    return this.turn({
      lookup: { group, offered: new Map() },
      messages: [{ role: 'user', content: askFor(group) }],
      turn: 1,
    })
  }

  private request(
    messages: readonly Anthropic.MessageParam[],
  ): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: this.config.aiMatchModel,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.config.aiMatchEffort },
      // The prompt and the tools never change, so this one breakpoint caches
      // them for every lookup; the top-level one follows the conversation.
      system: [{ type: 'text', text: AI_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: AI_TOOLS,
      tool_choice: { type: 'auto' },
      cache_control: { type: 'ephemeral' },
      messages: [...messages],
    }
  }

  private async turn({ lookup, messages, turn }: AiMatcherTurnProps): Promise<AiOutcome> {
    const response = await this.ai.send(this.request(messages))
    // Haiku 5.5 has no server-side fallback for a refusal, so it is no decision.
    if (response.stop_reason === STOP_REASONS.refusal) {
      return undecided('Claude declined to look this up.')
    }
    if (response.stop_reason !== STOP_REASONS.toolUse) {
      return undecided('The lookup ended without a choice.')
    }
    const uses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === BLOCK_TYPES.toolUse,
    )
    const choice = uses.find((use) => use.name === AI_TOOL_NAMES.choose)
    if (choice != null) return this.choose({ lookup, input: choice.input })
    if (turn >= AI_MAX_TURNS) return undecided(`No choice in ${AI_MAX_TURNS} turns.`)
    const results = await Promise.all(uses.map((use) => this.run({ lookup, use })))
    // The notice follows the tool results, which must come first, so the history stays append-only.
    const isLast = turn + 1 === AI_MAX_TURNS
    return this.turn({
      lookup,
      messages: [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: isLast ? [...results, LAST_REPLY] : results },
      ],
      turn: turn + 1,
    })
  }

  /** Runs one tool call; one raven cannot run is answered as an error, for Claude to recover from. */
  private run({ lookup, use }: AiMatcherRunProps): Promise<Anthropic.ToolResultBlockParam> {
    if (use.name === AI_TOOL_NAMES.search) return this.search({ lookup, use })
    if (use.name === AI_TOOL_NAMES.episodes) return this.episodes({ lookup, use })
    return Promise.resolve(
      answer({ use, content: `There is no tool called ${use.name}.`, isError: true }),
    )
  }

  private async search({
    lookup,
    use,
  }: AiMatcherSearchProps): Promise<Anthropic.ToolResultBlockParam> {
    const { input } = use
    if (!isSearchInput(input)) {
      return answer({
        use,
        content: `search_tmdb takes a type, a title of at most ${queryLength} characters, and a year from ${years.min} to ${years.max} or null.`,
        isError: true,
      })
    }
    const asked = { query: input.query, year: input.year }
    const found = (
      input.type === ITEM_TYPES.movie
        ? await this.tmdb.searchMovies(asked)
        : await this.tmdb.searchShows(asked)
    ).slice(0, AI_SEARCH_RESULTS)
    found.forEach((result) =>
      lookup.offered.set(offeredKey({ type: input.type, tmdbId: result.tmdbId }), pickOf(result)),
    )
    return answer({ use, content: JSON.stringify(found.map(describeCandidate)) })
  }

  private async episodes({
    lookup,
    use,
  }: AiMatcherEpisodesProps): Promise<Anthropic.ToolResultBlockParam> {
    const { input } = use
    if (!isEpisodesInput(input)) {
      return answer({
        use,
        content: `list_episodes takes a show id and a season number from ${seasons.min} to ${seasons.max}.`,
        isError: true,
      })
    }
    if (!lookup.offered.has(offeredKey({ type: ITEM_TYPES.show, tmdbId: input.tmdbId }))) {
      return answer({
        use,
        content: `Show ${input.tmdbId} came from no search in this lookup; search for it first.`,
        isError: true,
      })
    }
    const season = await this.tmdb
      .season({ showTmdbId: input.tmdbId, number: input.season })
      .catch((error: unknown) => {
        if (notFound(error)) return null
        throw error
      })
    if (season == null) {
      return answer({
        use,
        content: `TMDB lists no season ${input.season} of show ${input.tmdbId}.`,
      })
    }
    return answer({
      use,
      content: JSON.stringify({
        season: input.season,
        episodes: season.episodes.map((episode) => ({
          number: episode.number,
          title: episode.title,
        })),
      }),
    })
  }

  private choose({ lookup, input }: AiMatcherChooseProps): AiOutcome {
    if (!isChooseInput(input)) return undecided('Its answer did not fit choose_match.')
    const reason = input.reason.trim().slice(0, REASON_LENGTH)
    if (input.tmdbId == null) {
      return { kind: AI_OUTCOME_KINDS.none, confidence: input.confidence, reason }
    }
    const pick = lookup.offered.get(offeredKey({ type: lookup.group.type, tmdbId: input.tmdbId }))
    // An id no search offered in this lookup is never trusted, however sure Claude is.
    if (pick == null) {
      return undecided(`It chose ${input.tmdbId}, which no search in the lookup returned.`)
    }
    return { kind: AI_OUTCOME_KINDS.chosen, pick, confidence: input.confidence, reason }
  }
}
