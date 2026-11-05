import { randomBytes } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  REACHABILITY_PARAMS,
  REACHABILITY_PROBLEMS,
  REMOTE_ACCESS_STATES,
  type RemoteAccessSettings,
  type RemoteAccessStatus,
  isReachabilityReport,
  publicOriginOf,
  toQueryString,
} from '@raven/core'
import { CLOCK, type Clock } from '@/clock'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'

/** The one call raven makes to the outside check; `fetch` is one. */
type ReachabilityInit = { signal: AbortSignal }

type ReachabilityRequest = { url: string; init: ReachabilityInit }

export type ReachabilityFetch = (request: ReachabilityRequest) => Promise<Response>

/** The DI token the check's fetch is provided under, so a test can answer for Netlify. */
export const REACHABILITY_FETCH = Symbol('REACHABILITY_FETCH')

/** How long a check's nonce opens the echo: the outside check's own wait and then some. */
const NONCE_MS = 30_000

/** How long raven waits for the outside check, which itself waits 8 s for raven. */
const CHECK_TIMEOUT_MS = 15_000

/** How long a check's answer stands, so opening the page twice checks once. */
const RESULT_MS = 60_000

type PendingCheck = {
  expiresAt: number
  /** Whether the echo came with its client's address forwarded; null until it came. */
  isClientAddressForwarded: boolean | null
}

type LastCheck = { origin: string; at: number; status: RemoteAccessStatus }

type StatusOfProps = {
  settings: RemoteAccessSettings
  /** Checks again even when the last answer still stands: Apply, and Check again. */
  isFresh: boolean
}

type AnswerEchoProps = { nonce: string; isFromLan: boolean }

type CheckProps = { checkUrl: string; hostname: string; publicPort: number }

/**
 * Whether raven is reachable from outside its network. raven can not test
 * that from inside the LAN, so it asks the web app's site to: the site's
 * function fetches the public origin's echo with a nonce only a check in
 * flight here holds, and says what it found.
 */
@Injectable()
export class Reachability {
  private readonly logger = new Logger(Reachability.name)
  private readonly pending = new Map<string, PendingCheck>()
  private last: LastCheck | null = null

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REACHABILITY_FETCH) private readonly fetch: ReachabilityFetch,
  ) {}

  /**
   * Whether a nonce is one a check in flight minted. The echo's request is
   * the outside check's, so whether it reached raven from the LAN says
   * whether the reverse proxy forwards its clients' addresses.
   */
  answerEcho({ nonce, isFromLan }: AnswerEchoProps): boolean {
    const check = this.pending.get(nonce)
    if (check === undefined || check.expiresAt < this.clock.now()) return false
    this.pending.set(nonce, { ...check, isClientAddressForwarded: !isFromLan })
    return true
  }

  async statusOf({ settings, isFresh }: StatusOfProps): Promise<RemoteAccessStatus> {
    if (!settings.isEnabled) return { state: REMOTE_ACCESS_STATES.disabled }
    const origin = publicOriginOf(settings)
    if (origin === null || settings.hostname === null || settings.publicPort === null) {
      return { state: REMOTE_ACCESS_STATES.unconfigured }
    }
    const { checkUrl } = this.config.remoteAccess
    if (checkUrl === null) return { state: REMOTE_ACCESS_STATES.unchecked }
    const now = this.clock.now()
    const last = this.last
    if (!isFresh && last !== null && last.origin === origin && now - last.at < RESULT_MS) {
      return last.status
    }
    const status = await this.check({
      checkUrl,
      hostname: settings.hostname,
      publicPort: settings.publicPort,
    })
    this.last = { origin, at: this.clock.now(), status }
    return status
  }

  private async check({ checkUrl, hostname, publicPort }: CheckProps): Promise<RemoteAccessStatus> {
    const nonce = randomBytes(16).toString('base64url')
    this.pending.set(nonce, {
      expiresAt: this.clock.now() + NONCE_MS,
      isClientAddressForwarded: null,
    })
    const query = toQueryString({
      [REACHABILITY_PARAMS.host]: hostname,
      [REACHABILITY_PARAMS.port]: String(publicPort),
      [REACHABILITY_PARAMS.nonce]: nonce,
    })
    try {
      const response = await this.fetch({
        url: `${checkUrl}?${query}`,
        init: { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
      })
      const report: unknown = response.ok ? await response.json() : null
      const checkedAt = new Date(this.clock.now()).toISOString()
      if (!isReachabilityReport(report)) {
        this.logger.warn(`The reachability check answered ${response.status} with no report.`)
        return this.checkerFailed(checkedAt)
      }
      const seen = { publicAddress: report.publicAddress, resolved: report.resolved, checkedAt }
      if (report.state === REMOTE_ACCESS_STATES.unreachable) {
        return { state: REMOTE_ACCESS_STATES.unreachable, problem: report.problem, ...seen }
      }
      return {
        state: REMOTE_ACCESS_STATES.reachable,
        isClientAddressForwarded: this.pending.get(nonce)?.isClientAddressForwarded ?? false,
        ...seen,
      }
    } catch (error) {
      this.logger.warn(`The reachability check failed: ${errorMessage(error)}`)
      return this.checkerFailed(new Date(this.clock.now()).toISOString())
    } finally {
      this.pending.delete(nonce)
    }
  }

  private checkerFailed(checkedAt: string): RemoteAccessStatus {
    return {
      state: REMOTE_ACCESS_STATES.unreachable,
      problem: REACHABILITY_PROBLEMS.checkerFailed,
      publicAddress: null,
      resolved: [],
      checkedAt,
    }
  }
}
