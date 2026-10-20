import { Inject, Injectable } from '@nestjs/common'
import {
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  MEMBER_STATUSES,
  type Account,
  type AuthConfig,
} from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { AdminService } from '@/admin/adminService'
import { AuthSessions, accountOf } from '@/auth/authSessions'
import { AUTH_STATE } from '@/auth/effectiveAuth'

const isApprovedOwner = (account: Account): boolean =>
  account.status === MEMBER_STATUSES.approved && account.isOwner

/**
 * Who may manage raven. With accounts off it is the browser whose admin
 * lock is off, as before accounts. Once they are ready it is the approved
 * owner, by session or ticket, and nothing else: the admin password and
 * cookie decide nothing, and a request the account gate never bound is no
 * one.
 */
@Injectable()
export class Management {
  constructor(
    @Inject(AUTH_STATE) private readonly auth: AuthConfig,
    @Inject(AdminService) private readonly admin: Pick<AdminService, 'isLocked'>,
    @Inject(AuthSessions) private readonly sessions: Pick<AuthSessions, 'callerOf'>,
  ) {}

  /** Whether this server still manages by the admin password: accounts are off. */
  isLegacy(): boolean {
    return this.auth.state === AUTH_CONFIG_STATES.off
  }

  canManage({ request }: { request: Pick<FastifyRequest, 'headers'> }): boolean {
    switch (this.auth.state) {
      case AUTH_CONFIG_STATES.off:
        return !this.admin.isLocked({ cookie: request.headers[AUTH_HEADERS.cookie] })
      case AUTH_CONFIG_STATES.unavailable:
        return false
      case AUTH_CONFIG_STATES.ready:
        return this.isOwnerCaller({ request })
      default: {
        const unreachable: never = this.auth
        throw new Error(`Unknown auth state: ${JSON.stringify(unreachable)}`)
      }
    }
  }

  private isOwnerCaller({ request }: { request: object }): boolean {
    const account = accountOf(this.sessions.callerOf({ request }))
    return account !== null && isApprovedOwner(account)
  }
}
