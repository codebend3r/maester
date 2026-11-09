import type { Anthropic } from '@anthropic-ai/sdk'
import { Inject, Injectable } from '@nestjs/common'
import { isRecord, isString } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { AiClient } from '@/metadata/aiClient'
import type { AlbumToMatch } from '@/music/musicRepository'
import type { Scored, SearchTerms } from '@/music/releaseScoring'

type AiAlbumChoice = { mbid: string; reason: string }

const AI_TOOLS = { choose: 'choose_album', suggest: 'suggest_search' } as const
const AI_ALBUM_MAX_TOKENS = 1200
const AI_ALBUM_PROMPT = `You clean up unmatched albums in a private music library. Infer the album from its existing album title, album artist, year, track count, and the MusicBrainz candidates raven found. Choose only when one candidate is clearly the same release despite damaged tags, spelling, punctuation, a featured artist, or a file naming error. Return null rather than guessing. A chosen MusicBrainz id may cause duplicate rows for the same release to merge automatically.`
const AI_SEARCH_PROMPT = `You help a private music library find an album on MusicBrainz when a search by its tags found nothing. You are given the album's tag title and artist, its year, its track count, what its folder's name says, and its track titles. The tags may be damaged: typos, a missing first letter, broken accented characters, edition words, disc labels. Give the album's title and its artist as MusicBrainz most likely lists them, plain, without edition, disc or format words. Return null for the album when you cannot tell what it is.`

const AI_ALBUM_TOOLS: Anthropic.Tool[] = [
  {
    name: AI_TOOLS.choose,
    description: 'Choose the one offered MusicBrainz release that is clearly this album, or null.',
    input_schema: {
      type: 'object',
      properties: {
        mbid: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description:
            'An offered MusicBrainz release id, or null when the evidence is not enough.',
        },
        reason: { type: 'string', description: 'One short sentence explaining the evidence.' },
      },
      required: ['mbid', 'reason'],
      additionalProperties: false,
    },
  },
]

const AI_SEARCH_TOOLS: Anthropic.Tool[] = [
  {
    name: AI_TOOLS.suggest,
    description: 'Say what to search MusicBrainz for to find this album, or null for the album.',
    input_schema: {
      type: 'object',
      properties: {
        album: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'The album title as MusicBrainz lists it, or null when unsure.',
        },
        artist: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'The album artist as MusicBrainz credits it, or null for a compilation.',
        },
      },
      required: ['album', 'artist'],
      additionalProperties: false,
    },
  },
]

type AiChoiceOfProps = { input: unknown; offered: ReadonlySet<string> }

/** A Claude choice only when it names one of the releases raven offered. */
export const aiChoiceOf = ({ input, offered }: AiChoiceOfProps): AiAlbumChoice | null => {
  if (!isRecord(input) || !isString(input.mbid) || !isString(input.reason)) return null
  return offered.has(input.mbid) ? { mbid: input.mbid, reason: input.reason.slice(0, 500) } : null
}

/** The most characters of a title or artist Claude may have raven search for. */
const AI_TERM_MOST = 200

/** The search Claude suggested, when it named an album; its words are trimmed and capped. */
export const aiSearchOf = (input: unknown): SearchTerms | null => {
  if (!isRecord(input) || !isString(input.album)) return null
  const album = input.album.trim().slice(0, AI_TERM_MOST)
  if (album === '') return null
  const artist = isString(input.artist) ? input.artist.trim().slice(0, AI_TERM_MOST) : ''
  return { album, artist: artist === '' ? null : artist }
}

type AskProps = { system: string; tools: Anthropic.Tool[]; name: string; content: string }

type AlbumClaudePickProps = { album: AlbumToMatch; scored: readonly Scored[] }

type AlbumClaudeSuggestProps = { album: AlbumToMatch; tracks: readonly string[] }

/**
 * Claude's two parts in matching an album, each one of the day's AI
 * lookups: picking the release among those found when none is sure, and
 * saying what to search for when a search by the tags found nothing. Each
 * answer is checked before raven acts on it.
 */
@Injectable()
export class AlbumClaude {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AiClient) private readonly ai: AiClient,
  ) {}

  /** One request with one tool Claude must call; the tool's input, or null when it called none or the lookups are spent. */
  private async ask({ system, tools, name, content }: AskProps): Promise<unknown> {
    if (!this.ai.take()) return null
    const response = await this.ai.send({
      model: this.config.aiMatchModel,
      max_tokens: AI_ALBUM_MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.config.aiMatchEffort },
      system,
      tools,
      tool_choice: { type: 'tool', name },
      messages: [{ role: 'user', content }],
    })
    const [call] = response.content.flatMap((block) =>
      block.type === 'tool_use' && block.name === name ? [block] : [],
    )
    return call?.input ?? null
  }

  /** Claude's pick among the releases found, when it is clearly one of them. */
  async pick({ album, scored }: AlbumClaudePickProps): Promise<Scored | null> {
    if (scored.length === 0) return null
    const offered = new Set(scored.map(({ release }) => release.mbid))
    const input = await this.ask({
      system: AI_ALBUM_PROMPT,
      tools: AI_ALBUM_TOOLS,
      name: AI_TOOLS.choose,
      content: JSON.stringify({
        album,
        candidates: scored.map(({ release, confidence }) => ({
          mbid: release.mbid,
          title: release.title,
          artist: release.artist,
          year: release.year,
          trackCount: release.trackCount,
          country: release.country,
          isOfficial: release.isOfficial,
          confidence,
        })),
      }),
    })
    const picked = aiChoiceOf({ input, offered })
    if (picked === null) return null
    return scored.find(({ release }) => release.mbid === picked.mbid) ?? null
  }

  /** What Claude says to search for, reading the album's tags, folder and tracks; null when it cannot tell. */
  async suggest({ album, tracks }: AlbumClaudeSuggestProps): Promise<SearchTerms | null> {
    return aiSearchOf(
      await this.ask({
        system: AI_SEARCH_PROMPT,
        tools: AI_SEARCH_TOOLS,
        name: AI_TOOLS.suggest,
        content: JSON.stringify({ album, tracks }),
      }),
    )
  }
}
