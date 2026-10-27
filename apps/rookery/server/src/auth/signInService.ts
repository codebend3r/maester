import { setTimeout as sleep } from 'node:timers/promises'
import { Inject, Injectable } from '@nestjs/common'
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
import { ROUTES } from '@/routes'
import { SessionsRepository } from '@/sessions/sessionsRepository'
import { UsersRepository } from '@/users/usersRepository'

/** Why a sign-in came back without a session; `/login` shows a message for each. */
export const SIGN_IN_ERRORS = {
  notApproved: 'not_approved',
  expired: 'expired',
  plexUnavailable: 'plex_unavailable',
} as const

type SignInError = (typeof SIGN_IN_ERRORS)[keyof typeof SIGN_IN_ERRORS]

export const SIGN_IN_RESULT_KINDS = { signedIn: 'signed_in', failed: 'failed' } as const

export type SignInResult =
  | { kind: typeof SIGN_IN_RESULT_KINDS.signedIn; token: string; returnTo: string }
  | { kind: typeof SIGN_IN_RESULT_KINDS.failed; error: SignInError; returnTo: string | null }

/** The web app's pages the server sends a browser to. */
export const PAGE_PATHS = { home: '/', login: '/login' } as const

type SignInServiceReturnToProps = { value: unknown; fallback: string }

type SignInServiceStartProps = {
  returnTo: unknown
}

type SignInServiceCompleteProps = { pendingId: string | null }

type SignInServiceClaimTokenProps = {
  pin: PlexPin
  attempt?: number
}

type SignInServiceSignOutProps = { token: string | null }

@Injectable()
export class SignInService {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
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
  async start({
    returnTo,
  }: SignInServiceStartProps): Promise<{ pendingId: string; authUrl: string }> {
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
   * Finishes the sign-in Plex just sent the browser back from. The token can
   * trail the redirect by a moment, so the PIN is asked a few times before
   * the sign-in counts as not approved.
   */
  async complete({ pendingId }: SignInServiceCompleteProps): Promise<SignInResult> {
    const pending = pendingId ? this.pending.live({ id: pendingId, now: this.clock() }) : null
    if (!pending) {
      return { kind: SIGN_IN_RESULT_KINDS.failed, error: SIGN_IN_ERRORS.expired, returnTo: null }
    }
    const failed = (error: SignInError): SignInResult => ({
      kind: SIGN_IN_RESULT_KINDS.failed,
      error,
      returnTo: pending.returnTo,
    })
    try {
      const token = await this.claimToken({ pin: pending.pin })
      if (token == null) return failed(SIGN_IN_ERRORS.notApproved)
      const account = await this.plex.account(token)
      const now = this.clock()
      const user = this.users.signInWithPlex({ account, now })
      const session = this.sessions.create({ userId: user.id, now })
      this.pending.delete(pending.id)
      return { kind: SIGN_IN_RESULT_KINDS.signedIn, token: session, returnTo: pending.returnTo }
    } catch (error) {
      if (error instanceof PlexUnavailable) return failed(SIGN_IN_ERRORS.plexUnavailable)
      throw error
    }
  }

  private async claimToken({
    pin,
    attempt = 1,
  }: SignInServiceClaimTokenProps): Promise<string | null> {
    const token = await this.plex.checkPin(pin)
    if (token != null || attempt >= this.config.pinCheckAttempts) return token
    await sleep(this.config.pinCheckDelayMs)
    return this.claimToken({ pin, attempt: attempt + 1 })
  }

  signOut({ token }: SignInServiceSignOutProps): void {
    if (token) this.sessions.delete(token)
  }
}
