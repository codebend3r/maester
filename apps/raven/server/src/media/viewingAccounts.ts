import { Inject, Injectable, Logger } from '@nestjs/common'
import { AUTH_CONFIG_STATES, type Account, type AuthConfig, isRecord, isString } from '@raven/core'
import { AuthSessions, CALLERS } from '@/auth/authSessions'
import { AUTH_STATE } from '@/auth/effectiveAuth'
import { isApprovedOwner } from '@/auth/management'
import { type AccountKey, VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import { ViewingAdoption } from '@/media/viewingAdoption'
import { SettingsRepository } from '@/settings/settingsRepository'

/** How long the owner's requests wait after a failed adoption before one tries again, so a lasting fault logs once a minute. */
export const ADOPTION_RETRY_MS = 60_000

/** The SQLite result code better-sqlite3 gives its errors, or null for any other error. */
const sqliteCodeOf = (error: unknown): string | null =>
  isRecord(error) && isString(error.code) ? error.code : null

type LegacyKeyForProps = {
  auth: AuthConfig
  settings: Pick<SettingsRepository, 'viewingOwner'>
}

/** The adopted owner's key without accounts; never anyone's while accounts are ready or unavailable. */
const legacyKeyFor = ({ auth, settings }: LegacyKeyForProps): AccountKey => {
  if (auth.state !== AUTH_CONFIG_STATES.off) return VIEWING_ACCOUNTS.local
  return settings.viewingOwner() ?? VIEWING_ACCOUNTS.local
}

type ViewingAccountsKeyOfProps = { request: object }

type ViewingAccountsAdoptForProps = { account: Account }

/**
 * Which account's viewing a request reads and writes, from the caller the
 * account gate bound. Under accounts `ready`, the approved owner's first
 * request first takes over the viewing recorded before accounts.
 */
@Injectable()
export class ViewingAccounts {
  private readonly logger = new Logger(ViewingAccounts.name)
  /** Whose viewing a browser of a server without accounts shares; set only by an adoption, which needs accounts ready. */
  private readonly legacyKey: AccountKey
  /** Nothing writes under `VIEWING_ACCOUNTS.local` while accounts are ready, so once false it stays false. */
  private isAdoptionPending: boolean
  /**
   * When a failed adoption may be tried again; 0 until one fails. It also keeps a request that
   * asks for its key more than once from trying twice.
   */
  private retryAt = 0

  constructor(
    @Inject(AuthSessions) private readonly sessions: Pick<AuthSessions, 'callerOf'>,
    @Inject(AUTH_STATE) auth: AuthConfig,
    @Inject(SettingsRepository) settings: Pick<SettingsRepository, 'viewingOwner'>,
    @Inject(ViewingAdoption)
    private readonly adoption: Pick<ViewingAdoption, 'adopt' | 'hasLocalRows'>,
  ) {
    this.legacyKey = legacyKeyFor({ auth, settings })
    this.isAdoptionPending = auth.state === AUTH_CONFIG_STATES.ready && this.adoption.hasLocalRows()
  }

  keyOf({ request }: ViewingAccountsKeyOfProps): AccountKey {
    const caller = this.sessions.callerOf({ request })
    switch (caller.kind) {
      case CALLERS.legacy:
        return this.legacyKey
      case CALLERS.session:
      case CALLERS.ticket:
        this.adoptFor({ account: caller.session.account })
        return caller.session.account.id
      default: {
        const unreachable: never = caller
        // A caller holds an account's id and email, so the message carries only its type.
        throw new Error(`Unknown caller of type ${typeof unreachable}`)
      }
    }
  }

  /**
   * Gives the approved owner the viewing from before accounts, once. A
   * failure leaves it pending: this request goes on with the owner's own
   * viewing, and the owner's first request after `ADOPTION_RETRY_MS` tries
   * again. Only the SQLite code is logged, never the error's message.
   */
  private adoptFor({ account }: ViewingAccountsAdoptForProps): void {
    if (!this.isAdoptionPending || !isApprovedOwner(account)) return
    if (Date.now() < this.retryAt) return
    try {
      const {
        spots,
        plays,
        favourites,
        titleFavourites,
        albumFavourites,
        artistFavourites,
        playlists,
      } = this.adoption.adopt({ ownerId: account.id })
      this.isAdoptionPending = false
      this.logger.log(
        `Gave the owner the viewing history from before accounts: ${plays} plays, ${spots} resume spots, ${favourites + titleFavourites + albumFavourites + artistFavourites} favourites, ${playlists} playlists`,
      )
    } catch (error) {
      this.retryAt = Date.now() + ADOPTION_RETRY_MS
      this.logger.error(
        `Could not give the owner the viewing history from before accounts (SQLite code ${sqliteCodeOf(error) ?? 'none'}). Trying again in ${ADOPTION_RETRY_MS / 1000} s.`,
      )
    }
  }
}
