import { Inject, Injectable } from '@nestjs/common'
import { type ScrobbleService, isScrobbleService } from '@raven/core'
import { DatabaseService } from '@/db/database'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ScrobbleCipher } from '@/scrobbling/scrobbleCipher'

/** One account's link to a service: the name it goes by there. */
export type ScrobbleLink = { service: ScrobbleService; username: string }

type AccountService = { account: AccountKey; service: ScrobbleService }

/** What reading a link's secret found: no link, a secret this server's key cannot open, or the secret. */
export const SECRET_READS = {
  missing: 'missing',
  unopenable: 'unopenable',
  opened: 'opened',
} as const

type SecretRead =
  | { kind: typeof SECRET_READS.missing }
  | { kind: typeof SECRET_READS.unopenable }
  | { kind: typeof SECRET_READS.opened; secret: string }

type ScrobbleLinksListProps = { account: AccountKey }

type ScrobbleLinksSaveProps = AccountService & { username: string; secret: string; at: Date }

type ScrobbleLinksSecretOfProps = AccountService

type ScrobbleLinksRemoveProps = AccountService

type ContextOfProps = AccountService

/** What a sealed secret is bound to, so it opens only on its own account's row for its service. */
const contextOf = ({ account, service }: ContextOfProps): string => `${account} ${service}`

/**
 * Each account's links to ListenBrainz and Last.fm. The token or session
 * key is sealed by `ScrobbleCipher` before it is written and opened only to
 * send a listen; no read here hands it to a route.
 */
@Injectable()
export class ScrobbleLinks {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ScrobbleCipher) private readonly cipher: ScrobbleCipher,
  ) {}

  private get db() {
    return this.database.db
  }

  /** The account's links, by service. */
  list({ account }: ScrobbleLinksListProps): ScrobbleLink[] {
    return this.db
      .prepare<{ account: AccountKey }, { service: string; username: string }>(
        'SELECT service, username FROM scrobble_links WHERE account_id = @account ORDER BY service',
      )
      .all({ account })
      .flatMap(({ service, username }) =>
        isScrobbleService(service) ? [{ service, username }] : [],
      )
  }

  /** The account's token or session key for `service`, opened, or why there is none. */
  secretOf({ account, service }: ScrobbleLinksSecretOfProps): SecretRead {
    const row = this.db
      .prepare<AccountService, { sealed: string }>(
        `SELECT secret_cipher AS sealed FROM scrobble_links
          WHERE account_id = @account AND service = @service`,
      )
      .get({ account, service })
    if (row === undefined) return { kind: SECRET_READS.missing }
    const secret = this.cipher.open({
      sealed: row.sealed,
      context: contextOf({ account, service }),
    })
    return secret === null
      ? { kind: SECRET_READS.unopenable }
      : { kind: SECRET_READS.opened, secret }
  }

  /** Links `service`, in place of a link the account had to it before. */
  save({ account, service, username, secret, at }: ScrobbleLinksSaveProps): void {
    this.db
      .prepare(
        `INSERT INTO scrobble_links (account_id, service, username, secret_cipher, created_at)
         VALUES (@account, @service, @username, @sealed, @at)
         ON CONFLICT (account_id, service) DO UPDATE
           SET username = excluded.username, secret_cipher = excluded.secret_cipher,
               created_at = excluded.created_at`,
      )
      .run({
        account,
        service,
        username,
        sealed: this.cipher.seal({ plain: secret, context: contextOf({ account, service }) }),
        at: at.toISOString(),
      })
  }

  /** Forgets the link, and the listens still waiting to go to it. */
  remove({ account, service }: ScrobbleLinksRemoveProps): void {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM scrobble_queue WHERE account_id = @account AND service = @service')
        .run({ account, service })
      this.db
        .prepare('DELETE FROM scrobble_links WHERE account_id = @account AND service = @service')
        .run({ account, service })
    })()
  }
}
