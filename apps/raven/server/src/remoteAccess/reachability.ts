import { createHmac, randomBytes } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  PUBLIC_ORIGIN_STATES,
  REACHABILITY_PROBLEMS,
  REACHABILITY_TIMINGS,
  REMOTE_ACCESS_STATES,
  type ReachabilityReport,
  type RemoteAccessSettings,
  type RemoteAccessStatus,
  isReachabilityReport,
  publicOriginStateOf,
  reachabilityQueryString,
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

type AnswerEchoProps = { nonce: string; isAddressForwarded: boolean }

type CheckProps = {
  checkUrl: string
  proxySecret: Uint8Array
  hostname: string
  publicPort: number
}

type ReportOfProps = { url: string }

type SignatureOfProps = { nonce: string; proxySecret: Uint8Array }

/**
 * What proves a check is raven's: the HMAC-SHA256 of its nonce keyed with
 * `RAVEN_PROXY_SECRET`, in lower case hex. The reachability function holds
 * the same secret and answers no check without it, so it is no open probe
 * of any host and port for whoever calls it.
 */
export const checkSignatureOf = ({ nonce, proxySecret }: SignatureOfProps): string =>
  createHmac('sha256', proxySecret).update(nonce).digest('hex')

/**
 * Whether raven is reachable from outside its network. raven can not test
 * that from inside the LAN, so it asks the web app's site to: the site's
 * function fetches the public origin's echo with a nonce only a check in
 * flight here holds, and says what it found. The check is signed with
 * `RAVEN_PROXY_SECRET`; without the site's URL or that secret raven can not
 * ask, and says the check is `unchecked`.
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
   * the outside check's, so whether a trusted proxy forwarded its address
   * says whether raven sees who calls it from outside.
   */
  answerEcho({ nonce, isAddressForwarded }: AnswerEchoProps): boolean {
    const check = this.pending.get(nonce)
    if (check === undefined || check.expiresAt < this.clock.now()) return false
    this.pending.set(nonce, { ...check, isClientAddressForwarded: isAddressForwarded })
    return true
  }

  async statusOf({ settings, isFresh }: StatusOfProps): Promise<RemoteAccessStatus> {
    const publicOrigin = publicOriginStateOf(settings)
    if (publicOrigin.state !== PUBLIC_ORIGIN_STATES.configured) return { state: publicOrigin.state }
    const { checkUrl, proxySecret } = this.config.remoteAccess
    if (checkUrl === null || proxySecret === null) return { state: REMOTE_ACCESS_STATES.unchecked }
    const { origin, hostname, publicPort } = publicOrigin
    const now = this.clock.now()
    const last = this.last
    if (!isFresh && last !== null && last.origin === origin && now - last.at < RESULT_MS) {
      return last.status
    }
    const status = await this.check({ checkUrl, proxySecret, hostname, publicPort })
    this.last = { origin, at: this.clock.now(), status }
    return status
  }

  private async check({
    checkUrl,
    proxySecret,
    hostname,
    publicPort,
  }: CheckProps): Promise<RemoteAccessStatus> {
    const nonce = randomBytes(16).toString('base64url')
    this.pending.set(nonce, {
      expiresAt: this.clock.now() + REACHABILITY_TIMINGS.nonceMs,
      isClientAddressForwarded: null,
    })
    const query = reachabilityQueryString({
      host: hostname,
      port: publicPort,
      nonce,
      signature: checkSignatureOf({ nonce, proxySecret }),
    })
    const report = await this.reportOf({ url: `${checkUrl}?${query}` })
    const isClientAddressForwarded = this.pending.get(nonce)?.isClientAddressForwarded ?? false
    this.pending.delete(nonce)
    const checkedAt = new Date(this.clock.now()).toISOString()
    if (report === null) {
      return {
        state: REMOTE_ACCESS_STATES.unreachable,
        problem: REACHABILITY_PROBLEMS.checkerFailed,
        publicAddress: null,
        resolved: [],
        checkedAt,
      }
    }
    const seen = { publicAddress: report.publicAddress, resolved: report.resolved, checkedAt }
    if (report.state === REMOTE_ACCESS_STATES.unreachable) {
      return { state: REMOTE_ACCESS_STATES.unreachable, problem: report.problem, ...seen }
    }
    return { state: REMOTE_ACCESS_STATES.reachable, isClientAddressForwarded, ...seen }
  }

  /** What the outside check reported, or null when it could not run or answered no report. */
  private async reportOf({ url }: ReportOfProps): Promise<ReachabilityReport | null> {
    try {
      const response = await this.fetch({
        url,
        init: { signal: AbortSignal.timeout(REACHABILITY_TIMINGS.checkTimeoutMs) },
      })
      const report: unknown = response.ok ? await response.json() : null
      if (isReachabilityReport(report)) return report
      this.logger.warn(`The reachability check answered ${response.status} with no report.`)
      return null
    } catch (error) {
      this.logger.warn(`The reachability check failed: ${errorMessage(error)}`)
      return null
    }
  }
}
