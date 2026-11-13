import { setTimeout as sleep } from 'node:timers/promises'
import { Inject, Injectable } from '@nestjs/common'
import { PAGE_PATHS, ROUTES, SIGN_IN_ERRORS, type SignInError } from '@rookery/core'
import { CLOCK, type Clock } from '@/clock'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { PendingSignIns } from '@/auth/pendingSignIns'
import { safeReturnTo } from '@/auth/returnTo'
import {
  PLEX_TV_CLIENT,
  type PlexPin,
  type PlexTv,
  PlexUnavailable,
  plexAuthUrl,
} from '@/plex/plexTv'
import { SessionsRepository } from '@/sessions/sessionsRepository'
import { UsersRepository } from '@/users/usersRepository'

/** How often the callback asks plex.tv for the PIN's token, since it can trail the redirect. */
export type PinCheck = { attempts: number; delayMs: number }

export const DEFAULT_PIN_CHECK = { attempts: 5, delayMs: 1000 } as const satisfies PinCheck

/** The DI token the PIN check is provided under, so tests need not wait between checks. */
export const PIN_CHECK = Symbol('PIN_CHECK')

export const SIGN_IN_RESULT_KINDS = { signedIn: 'signed_in', failed: 'failed' } as const

export type SignInResult =
  | { kind: typeof SIGN_IN_RESULT_KINDS.signedIn; token: string; returnTo: string }
  | { kind: typeof SIGN_IN_RESULT_KINDS.failed; error: SignInError; returnTo: string | null }

/** A sign-in just opened: the pending sign-in's id for the pin cookie, and where to send the browser. */
export type StartedSignIn = { pendingId: string; authUrl: string }

type SignInServiceReturnToProps = { value: unknown; fallback: string }

type SignInServiceStartProps = {
  returnTo: unknown
}

type SignInServiceCompleteProps = { pendingId: string | null }

type SignInServiceClaimTokenProps = {
  pin: PlexPin
  attempt: number
}

type SignInServiceSignOutProps = { token: string | null }

@Injectable()
export class SignInService {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(PIN_CHECK) private readonly pinCheck: PinCheck,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PLEX_TV_CLIENT) private readonly plex: PlexTv,
    @Inject(PendingSignIns) private readonly pending: PendingSignIns,
    @Inject(UsersRepository) private readonly users: UsersRepository,
    @Inject(SessionsRepository) private readonly sessions: SessionsRepository,
  ) {}

  /** Where a browser may go next, or `fallback`. */
  returnTo({ value, fallback }: SignInServiceReturnToProps): string {
    return safeReturnTo({ value, appOrigins: this.config.appOrigins, fallback })
  }

  /** Opens a PIN at plex.tv; returns the pending sign-in's id and where to send the browser. */
  async start({ returnTo }: SignInServiceStartProps): Promise<StartedSignIn> {
    const pin = await this.plex.createPin()
    const pendingId = this.pending.create({
      pin,
      returnTo: this.returnTo({ value: returnTo, fallback: PAGE_PATHS.home }),
      now: this.clock(),
    })
    return {
      pendingId,
      authUrl: plexAuthUrl({
        code: pin.code,
        forwardUrl: `${this.config.publicUrl}${ROUTES.callback}`,
      }),
    }
  }

  /**
   * Finishes the sign-in Plex just sent the browser back from. The pending
   * sign-in is claimed first, so it is used once whatever happens next. The
   * token can trail the redirect by a moment, so the PIN is asked a few times
   * before the sign-in counts as not approved.
   */
  async complete({ pendingId }: SignInServiceCompleteProps): Promise<SignInResult> {
    const pending = pendingId ? this.pending.claim({ id: pendingId, now: this.clock() }) : null
    if (!pending) {
      return { kind: SIGN_IN_RESULT_KINDS.failed, error: SIGN_IN_ERRORS.expired, returnTo: null }
    }
    const failed = (error: SignInError): SignInResult => ({
      kind: SIGN_IN_RESULT_KINDS.failed,
      error,
      returnTo: pending.returnTo,
    })
    try {
      const token = await this.claimToken({ pin: pending.pin, attempt: 1 })
      if (token == null) return failed(SIGN_IN_ERRORS.notApproved)
      const account = await this.plex.account(token)
      const now = this.clock()
      const user = this.users.signInWithPlex({ account, now })
      const session = this.sessions.create({ userId: user.id, now })
      return { kind: SIGN_IN_RESULT_KINDS.signedIn, token: session, returnTo: pending.returnTo }
    } catch (error) {
      if (error instanceof PlexUnavailable) return failed(SIGN_IN_ERRORS.plexUnavailable)
      throw error
    }
  }

  private async claimToken({ pin, attempt }: SignInServiceClaimTokenProps): Promise<string | null> {
    const token = await this.plex.checkPin(pin)
    if (token != null || attempt >= this.pinCheck.attempts) return token
    await sleep(this.pinCheck.delayMs)
    return this.claimToken({ pin, attempt: attempt + 1 })
  }

  signOut({ token }: SignInServiceSignOutProps): void {
    if (token) this.sessions.delete(token)
  }
}
