import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/clock'
import { SESSION_KINDS, SessionsRepository } from '@/sessions/sessionsRepository'
import { type PlexLogin, type User, UsersRepository } from '@/users/usersRepository'

/** Who a session token belongs to, as `/api/me` and `/internal/session` report it. */
export type Account =
  | { kind: typeof SESSION_KINDS.live; user: User; plex: PlexLogin | null; expiresAt: string }
  | { kind: typeof SESSION_KINDS.unknown }
  | { kind: typeof SESSION_KINDS.expired }

@Injectable()
export class AccountService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SessionsRepository) private readonly sessions: SessionsRepository,
    @Inject(UsersRepository) private readonly users: UsersRepository,
  ) {}

  forToken(token: string | null): Account {
    if (!token) return { kind: SESSION_KINDS.unknown }
    const now = this.clock()
    const found = this.sessions.lookup({ token, now })
    if (found.kind !== SESSION_KINDS.live) return found
    const user = this.users.get(found.session.userId)
    if (!user) return { kind: SESSION_KINDS.unknown }
    if (found.touched) this.users.touch({ id: user.id, now })
    return {
      kind: SESSION_KINDS.live,
      user,
      plex: this.users.plexLogin(user.id),
      expiresAt: found.session.expiresAt,
    }
  }
}
