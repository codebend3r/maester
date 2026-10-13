import {
  Anthropic,
  APIError,
  AuthenticationError,
  BadRequestError,
  type ClientOptions,
  NotFoundError,
  PermissionDeniedError,
} from '@anthropic-ai/sdk'
import { Inject, Injectable } from '@nestjs/common'
import { isRecord, isString, type MetadataServiceState } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'

/**
 * The slice of `fetch` the Anthropic client takes, injected so tests answer
 * for Claude and never touch the network.
 */
export type AiFetch = NonNullable<ClientOptions['fetch']>

/** The DI token the fetch is provided under. */
export const AI_FETCH = Symbol('AI_FETCH')

const API = 'https://api.anthropic.com'

/** One request may take this long; a lookup's replies are short. */
const TIMEOUT_MS = 60_000

/** The AI lookup could not ask: no key, a refused key, or Anthropic away. */
export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

export type AiState = { state: MetadataServiceState; error: string | null }

/** Today in UTC, when the day's count starts again, as OMDb's does. */
const today = (): string => new Date().toISOString().slice(0, 10)

/** A failed answer's status, and Anthropic's own words for it when its error body has some. */
const said = ({ status, body }: { status: number; body: unknown }): string => {
  const words = isRecord(body) && isRecord(body.error) ? body.error.message : null
  return isString(words) && words.trim() !== '' ? `${status}: ${words}` : String(status)
}

/**
 * Claude, through Anthropic's SDK, with raven's own key: the key, the
 * token, the profile and the base URL come from raven's config, never the
 * environment (the SDK still adds `ANTHROPIC_CUSTOM_HEADERS` if set).
 * Counts the day's lookups against `AI_DAILY_LIMIT`, starting again at
 * midnight UTC, and stops for good, until a restart, once Anthropic refuses
 * the key or turns a request down in a way no retry would change.
 */
@Injectable()
export class AiClient {
  private readonly client: Anthropic | null
  private readonly budget = { day: today(), used: 0 }
  private readonly status: { error: string | null; isRefused: boolean } = {
    error: null,
    isRefused: false,
  }

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AI_FETCH) fetch: AiFetch,
  ) {
    const apiKey = config.anthropicApiKey
    this.client =
      apiKey == null
        ? null
        : new Anthropic({
            apiKey,
            authToken: null,
            baseURL: API,
            fetch,
            timeout: TIMEOUT_MS,
            logLevel: 'off',
          })
  }

  private usedToday(): number {
    if (this.budget.day !== today()) {
      this.budget.day = today()
      this.budget.used = 0
    }
    return this.budget.used
  }

  /** Whether there is a key, it was not refused, and today's lookups are not spent. */
  get enabled(): boolean {
    return (
      this.client != null && !this.status.isRefused && this.usedToday() < this.config.aiDailyLimit
    )
  }

  /** Lookups left today; none while the lookup is off or its key was refused. */
  remaining(): number {
    return this.client == null || this.status.isRefused
      ? 0
      : Math.max(0, this.config.aiDailyLimit - this.usedToday())
  }

  /** Books one of today's lookups; false once they are spent, or while the lookup is off. */
  take(): boolean {
    if (!this.enabled) return false
    this.budget.used += 1
    return true
  }

  state(): AiState {
    if (this.client == null) return { state: 'off', error: null }
    return { state: this.status.error == null ? 'ok' : 'failing', error: this.status.error }
  }

  /** One request to Claude. Failing throws an `AiError` whose message never holds the key. */
  async send(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    const { client } = this
    if (client == null || this.status.isRefused) throw new AiError('The AI lookup is off.')
    try {
      const message = await client.messages.create(params)
      this.status.error = null
      return message
    } catch (error) {
      const reason = this.failure(error)
      this.status.error = reason
      throw new AiError(reason)
    }
  }

  /**
   * Why a request failed, with what Anthropic said, which never holds the
   * key. A refused key, or a request turned down whatever is asked (a model
   * id or an effort Anthropic does not take), stops lookups for good.
   */
  private failure(error: unknown): string {
    if (!(error instanceof APIError) || error.status == null) {
      return 'Anthropic could not be reached.'
    }
    const answer = said({ status: error.status, body: error.error })
    if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
      this.status.isRefused = true
      return `Anthropic refused the key (${answer}). Check ANTHROPIC_API_KEY and restart.`
    }
    if (error instanceof BadRequestError || error instanceof NotFoundError) {
      this.status.isRefused = true
      return `Anthropic turned the request down (${answer}). Check AI_MATCH_MODEL and AI_MATCH_EFFORT, and restart.`
    }
    return `Anthropic answered ${answer}.`
  }
}
