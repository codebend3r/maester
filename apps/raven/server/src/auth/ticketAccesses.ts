import { Inject, Injectable } from '@nestjs/common'
import { filter, map } from 'rxjs'
import { AccessRechecks } from '@/auth/accessRechecks'
import type { PassAccess } from '@/auth/accountPasses'
import { AuthSessions, CALLERS } from '@/auth/authSessions'
import { LockService } from '@/lock/lockService'

type TicketAccessesAccessOfProps = { request: object; mediaId: number }

/**
 * What a request an account ticket opened stands for, to open a pass on a
 * media with, for the HLS master and `file` alike: the account and unlock
 * the ticket carried, rechecked as an open response is, and the PIN's
 * relocks of that account.
 */
@Injectable()
export class TicketAccesses {
  constructor(
    @Inject(AuthSessions) private readonly callers: Pick<AuthSessions, 'callerOf'>,
    @Inject(AccessRechecks) private readonly rechecks: Pick<AccessRechecks, 'ended'>,
    @Inject(LockService) private readonly lock: Pick<LockService, 'relocks' | 'unlockNeedOf'>,
  ) {}

  /** The access for media `mediaId`; null for any caller but an account ticket, which earns no pass. */
  accessOf({ request, mediaId }: TicketAccessesAccessOfProps): PassAccess | null {
    const caller = this.callers.callerOf({ request })
    if (caller.kind !== CALLERS.ticket) return null
    const { account } = caller.session
    return {
      account,
      unlockedUntil: caller.unlockedUntil,
      ended: this.rechecks.ended({ request }),
      relocked: this.lock.relocks.pipe(
        filter((accountId) => accountId === account.id),
        map(() => undefined),
      ),
      needsUnlock: this.lock.unlockNeedOf({ mediaId }),
    }
  }
}
