import { randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { isNumber, isString, object } from '@raven/core'
import { CLOCK, type Clock } from '@/clock'
import { parseJsonAs } from '@/db/json'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ScrobbleCipher } from '@/scrobbling/scrobbleCipher'

/** How long a sign-in may take on Last.fm's page before its state is refused. */
export const LASTFM_SIGN_IN_MS = 10 * 60 * 1000

/** At most this many sign-ins wait at once, the oldest given up first past it. */
const MAX_WAITING = 256

const isSignInState = object({
  account: isString,
  returnTo: isString,
  nonce: isString,
  expires: isNumber,
})

/** A sign-in the callback finished: whose it was, and where it goes back to. */
type SignIn = { account: AccountKey; returnTo: string }

/**
 * A finished sign-in, with the access token of the session that started it
 * (null without accounts), so the callback can ask whether the account is
 * still approved. The token stays in memory only, never logged or written.
 */
type FinishedSignIn = SignIn & { token: string | null }

type LastFmSignInsStartProps = FinishedSignIn

/** A sign-in waiting for its callback, under its nonce. */
type Waiting = { account: AccountKey; token: string | null; expires: number }

/**
 * Last.fm's sign-ins under way. `start` gives one a `state` for the
 * callback's address: its account, return address, a random nonce and when
 * it expires, in base64url JSON, then a dot and its HMAC under the server's
 * scrobble key. The nonce is kept in memory until the state is used or
 * expires (10 minutes), so `finish` takes a state once: a replay, a
 * forgery, an expired one and one from before a restart all get null.
 * Each account has one sign-in waiting at most, a new start replacing its
 * last, so one viewer starting over and over never pushes out another's;
 * the cap on them all is a backstop.
 */
@Injectable()
export class LastFmSignIns {
  private readonly waiting = new Map<string, Waiting>()

  constructor(
    @Inject(ScrobbleCipher) private readonly cipher: ScrobbleCipher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private prune(): void {
    const now = this.clock.now()
    ;[...this.waiting].forEach(([nonce, { expires }]) => {
      if (expires <= now) this.waiting.delete(nonce)
    })
    const over = this.waiting.size - MAX_WAITING
    ;[...this.waiting.keys()].slice(0, Math.max(0, over)).forEach((nonce) => {
      this.waiting.delete(nonce)
    })
  }

  start({ account, returnTo, token }: LastFmSignInsStartProps): string {
    ;[...this.waiting].forEach(([held, waiting]) => {
      if (waiting.account === account) this.waiting.delete(held)
    })
    this.prune()
    const nonce = randomBytes(16).toString('base64url')
    const expires = this.clock.now() + LASTFM_SIGN_IN_MS
    this.waiting.set(nonce, { account, token, expires })
    const text = Buffer.from(JSON.stringify({ account, returnTo, nonce, expires })).toString(
      'base64url',
    )
    return `${text}.${this.cipher.sign(text)}`
  }

  /** The sign-in `state` names, used up, or null for one that is not a live state of this server's. */
  finish(state: string): FinishedSignIn | null {
    this.prune()
    const [text, signature, ...rest] = state.split('.')
    if (text === undefined || signature === undefined || rest.length > 0) return null
    if (!this.cipher.isSigned({ text, signature })) return null
    const parsed = parseJsonAs({
      json: Buffer.from(text, 'base64url').toString('utf8'),
      guard: isSignInState,
    })
    const waiting = parsed === null ? undefined : this.waiting.get(parsed.nonce)
    if (parsed === null || waiting === undefined || waiting.account !== parsed.account) return null
    this.waiting.delete(parsed.nonce)
    if (parsed.expires <= this.clock.now()) return null
    return { account: parsed.account, returnTo: parsed.returnTo, token: waiting.token }
  }
}
