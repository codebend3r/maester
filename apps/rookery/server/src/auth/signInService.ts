import { setTimeout as sleep } from 'node:timers/promises'
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/clock.js'
import { SERVER_CONFIG, type ServerConfig } from '@/config.js'
import { PendingSignIns } from '@/auth/pendingSignIns.js'
import { safeReturnTo } from '@/auth/returnTo.js'
import {
  PLEX_TV_CLIENT,
  type PlexPin,
  type PlexTv,
  PlexUnavailable,
  plexAuthUrl,
} from '@/plex/plexTv.js'
import { SessionsRepository } from '@/sessions/sessionsRepository.js'
import { UsersRepository } from '@/users/usersRepository.js'

/** Why a sign-in came back without a session; `/login` shows a message for each. */
export type SignInError = 'not_approved' | 'expired' | 'plex_unavailable'

export type SignInResult =
  | { kind: 'signed_in'; token: string; returnTo: string }
  | { kind: 'failed'; error: SignInError; returnTo: string | null }

export const CALLBACK_PATH = '/auth/plex/callback'

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
  returnTo({ value, fallback }: { value: unknown; fallback: string }): string {
    return safeReturnTo({ value, appOrigins: this.config.appOrigins, fallback })
  }

  /** Opens a PIN at plex.tv; returns the pending sign-in's id and where to send the browser. */
  async start({
    returnTo,
  }: {
    returnTo: unknown
  }): Promise<{ pendingId: string; authUrl: string }> {
    const pin = await this.plex.createPin()
    const pendingId = this.pending.create({
      pin,
      returnTo: this.returnTo({ value: returnTo, fallback: '/' }),
      now: this.clock(),
    })
    return {
      pendingId,
      authUrl: plexAuthUrl({
        code: pin.code,
        forwardUrl: `${this.config.publicUrl}${CALLBACK_PATH}`,
      }),
    }
  }

  /**
   * Finishes the sign-in Plex just sent the browser back from. The token can
   * trail the redirect by a moment, so the PIN is asked a few times before
   * the sign-in counts as not approved.
   */
  async complete({ pendingId }: { pendingId: string | null }): Promise<SignInResult> {
    const pending = pendingId ? this.pending.live({ id: pendingId, now: this.clock() }) : null
    if (!pending) return { kind: 'failed', error: 'expired', returnTo: null }
    const failed = (error: SignInError): SignInResult => ({
      kind: 'failed',
      error,
      returnTo: pending.returnTo,
    })
    try {
      const token = await this.claimToken({ pin: pending.pin })
      if (token == null) return failed('not_approved')
      const account = await this.plex.account(token)
      const now = this.clock()
      const user = this.users.signInWithPlex({ account, now })
      const session = this.sessions.create({ userId: user.id, now })
      this.pending.delete(pending.id)
      return { kind: 'signed_in', token: session, returnTo: pending.returnTo }
    } catch (error) {
      if (error instanceof PlexUnavailable) return failed('plex_unavailable')
      throw error
    }
  }

  private async claimToken({
    pin,
    attempt = 1,
  }: {
    pin: PlexPin
    attempt?: number
  }): Promise<string | null> {
    const token = await this.plex.checkPin(pin)
    if (token != null || attempt >= this.config.pinCheckAttempts) return token
    await sleep(this.config.pinCheckDelayMs)
    return this.claimToken({ pin, attempt: attempt + 1 })
  }

  signOut({ token }: { token: string | null }): void {
    if (token) this.sessions.delete(token)
  }
}
