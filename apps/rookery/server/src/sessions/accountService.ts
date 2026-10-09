import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/clock.js'
import { SessionsRepository } from '@/sessions/sessionsRepository.js'
import { type PlexLogin, type User, UsersRepository } from '@/users/usersRepository.js'

/** Who a session token belongs to, as `/api/me` and `/internal/session` report it. */
export type Account =
  | { kind: 'live'; user: User; plex: PlexLogin | null; expiresAt: string }
  | { kind: 'unknown' }
  | { kind: 'expired' }

@Injectable()
export class AccountService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SessionsRepository) private readonly sessions: SessionsRepository,
    @Inject(UsersRepository) private readonly users: UsersRepository,
  ) {}

  forToken(token: string | null): Account {
    if (!token) return { kind: 'unknown' }
    const now = this.clock()
    const found = this.sessions.lookup({ token, now })
    if (found.kind !== 'live') return found
    const user = this.users.get(found.session.userId)
    if (!user) return { kind: 'unknown' }
    if (found.touched) this.users.touch({ id: user.id, now })
    return {
      kind: 'live',
      user,
      plex: this.users.plexLogin(user.id),
      expiresAt: found.session.expiresAt,
    }
  }
}
