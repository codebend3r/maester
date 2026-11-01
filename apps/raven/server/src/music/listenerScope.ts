import { Inject, Injectable } from '@nestjs/common'
import { LIBRARY_KINDS } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { LockService } from '@/lock/lockService'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { PLAY_KINDS } from '@/media/watchedRepository'

/** Whose plays and playlists a read takes, and the libraries whose tracks it may not see. */
export type ListenerScope = {
  account: AccountKey
  /** Libraries the caller may not see: their tracks are left out, and a seed in one is locked. */
  hidden: readonly number[]
}

/**
 * A track, by `m`, that a mix, a radio or Home may hold: in a music library
 * (an audiobook's chapters are filed as tracks too) the caller sees.
 */
export const LISTENABLE = `m.library_id IN (SELECT id FROM libraries WHERE kind = @music)
                           AND m.library_id NOT IN (SELECT value FROM json_each(@hidden))`

type ListenerParamsProps = ListenerScope

/** The parameters `LISTENABLE` and the account's plays read. */
export const listenerParams = (scope: ListenerParamsProps) => ({
  account: scope.account,
  hidden: JSON.stringify(scope.hidden),
  played: PLAY_KINDS.played,
  music: LIBRARY_KINDS.music,
})

type ListenerScopesOfProps = { request: FastifyRequest }

/** The scope a request reads mixes, radio and playlists in. */
@Injectable()
export class ListenerScopes {
  constructor(
    @Inject(LockService) private readonly lock: LockService,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  of({ request }: ListenerScopesOfProps): ListenerScope {
    const viewer = this.lock.viewer({ request })
    return {
      account: this.accounts.keyOf({ request }),
      hidden: [...this.libraries.lockedIds()].filter((id) => !viewer.seesLibrary(id)),
    }
  }
}
