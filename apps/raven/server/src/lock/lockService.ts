import { createHmac, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { AUTH_HEADERS, AUTH_REFUSALS, type LockState } from '@raven/core'
import { readCookie, sameSecret } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { authFailure } from '@/auth/authFailure'
import { AuthSessions, CALLERS, accountOf } from '@/auth/authSessions'
import { Management } from '@/auth/management'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { WrongTries } from '@/lock/wrongTries'
import { MediaIndex } from '@/media/mediaIndex'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** What a route's `:id` names, so its library can be found: a library, a video, or a movie or show. */
export const PRIVACIES = { library: 'library', media: 'media', item: 'item' } as const

export type Privacy = (typeof PRIVACIES)[keyof typeof PRIVACIES]

/** What one request may see of the locked libraries. */
export type Viewer = {
  /** A library shows at all, by its name and type, unless it is locked and the caller cannot manage. */
  listsLibrary: (libraryId: number) => boolean
  /** A library's videos show when it is not locked, or this caller has unlocked it. */
  seesLibrary: (libraryId: number) => boolean
  /** A movie or show shows when a library it may show from holds a file of it. */
  seesItem: (itemId: number) => boolean
  /** Whether what a route's id names may show; an id that names nothing is the route's to refuse. */
  sees: (args: { privacy: Privacy; id: number }) => boolean
}

type Request = Pick<FastifyRequest, 'headers'>

/** How unlocking went: a cookie to set, or why not with the status to say it with. */
export type Unlocking =
  | { ok: true; cookie: string }
  | { ok: false; status: 401 | 429 | 503; message: string }

export const UNLOCK_COOKIE = 'raven_unlock'
/** What the unlock cookie names for a caller no account is behind: the browser of a server without accounts. */
const NO_ACCOUNT = ''
const COOKIE_PARTS = 3
/** An unlocked browser stays so this long, or until it locks again or the server restarts. */
const SESSION_MS = 12 * 60 * 60_000

/** With nothing locked, or the PIN entered: everything shows, and nothing more is looked up. */
const EVERYTHING: Viewer = {
  listsLibrary: () => true,
  seesLibrary: () => true,
  seesItem: () => true,
  sees: () => true,
}

/**
 * Keeps locked libraries behind the server's PIN. Entering it gives the
 * browser a session cookie signed with a key that lives only as long as
 * the process, and naming the account that entered it, so another account
 * on the same browser inherits nothing. Without a PIN set, locked libraries
 * stay shut: forgetting the setting never opens them. Whoever cannot manage
 * raven, a member once accounts are ready or a browser the admin lock holds
 * before, has the PIN open nothing, and locked libraries are left out
 * altogether.
 */
@Injectable()
export class LockService {
  private readonly key = randomBytes(32)
  private readonly tries = new WrongTries()

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(LibrariesRepository) private readonly libraries: Pick<LibrariesRepository, 'lockedIds'>,
    @Inject(MediaIndex) private readonly index: Pick<MediaIndex, 'libraryOf'>,
    @Inject(MetadataRepository)
    private readonly metadata: Pick<MetadataRepository, 'librariesHolding'>,
    @Inject(Management) private readonly management: Pick<Management, 'canManage' | 'isLegacy'>,
    @Inject(AuthSessions) private readonly sessions: Pick<AuthSessions, 'callerOf'>,
  ) {}

  get available(): boolean {
    return this.config.libraryPin != null
  }

  state({ request }: { request: Request }): LockState {
    if (!this.isOwnerOrLegacy({ request })) return { available: false, unlocked: false }
    return { available: this.available, unlocked: this.isUnlocked({ request }) }
  }

  /** Throws 403 `not_owner` for an account that is not the owner, before the PIN is even looked at. */
  unlock({ pin, request }: { pin: string; request: Request }): Unlocking {
    if (!this.isOwnerOrLegacy({ request })) throw authFailure(AUTH_REFUSALS.notOwner)
    const expected = this.config.libraryPin
    if (expected == null) {
      return { ok: false, status: 503, message: "Set LIBRARY_PIN in raven's .env to unlock." }
    }
    if (this.tries.isWaiting) {
      return { ok: false, status: 429, message: 'Too many wrong PINs. Try again in a minute.' }
    }
    if (!sameSecret({ given: pin, expected })) {
      this.tries.fail()
      return { ok: false, status: 401, message: 'That PIN is not right.' }
    }
    this.tries.succeed()
    const payload = `${Date.now() + SESSION_MS}.${this.accountIdOf({ request })}`
    return {
      ok: true,
      cookie: `${UNLOCK_COOKIE}=${payload}.${this.sign(payload)}; ${this.attributes()}`,
    }
  }

  /** The cookie that forgets the session. */
  lockCookie(): string {
    return `${UNLOCK_COOKIE}=; Max-Age=0; ${this.attributes()}`
  }

  viewer({ request }: { request: Request }): Viewer {
    const locked = this.libraries.lockedIds()
    if (locked.size === 0 || this.isUnlocked({ request })) return EVERYTHING
    const isHidden = !this.management.canManage({ request })
    const listsLibrary = (libraryId: number): boolean => !isHidden || !locked.has(libraryId)
    const seesLibrary = (libraryId: number): boolean => !locked.has(libraryId)
    const seesItem = (itemId: number): boolean => {
      const holding = this.metadata.librariesHolding(itemId)
      // An item no library holds is one a type change or rescan left waiting;
      // it may be a locked library's.
      return holding.some(seesLibrary)
    }
    const sees = ({ privacy, id }: { privacy: Privacy; id: number }): boolean => {
      switch (privacy) {
        case PRIVACIES.library:
          return seesLibrary(id)
        case PRIVACIES.media: {
          const libraryId = this.index.libraryOf(id)
          return libraryId == null || seesLibrary(libraryId)
        }
        case PRIVACIES.item:
          return seesItem(id)
        default: {
          const unknown: never = privacy
          return unknown
        }
      }
    }
    return { listsLibrary, seesLibrary, seesItem, sees }
  }

  /** Scoped to the API, out of reach of scripts, and never sent from another site. */
  private attributes(): string {
    return 'Path=/api; HttpOnly; SameSite=Strict'
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url')
  }

  /** The account id the unlock cookie names for the request: none for a server without accounts or an unbound request. */
  private accountIdOf({ request }: { request: Request }): string {
    return accountOf(this.sessions.callerOf({ request }))?.id ?? NO_ACCOUNT
  }

  /** Whether the PIN is this caller's to enter: the owner once accounts are ready, anyone before. */
  private isOwnerOrLegacy({ request }: { request: Request }): boolean {
    return this.management.isLegacy() || this.management.canManage({ request })
  }

  /**
   * Until when this caller has the PIN entered, or null when it has not:
   * its unlock cookie's expiry, or for an account ticket the unlock its
   * owner minted it under, whichever holds longer. Only a caller who may
   * manage raven is ever unlocked.
   */
  unlockedUntil({ request }: { request: Request }): number | null {
    if (!this.management.canManage({ request })) return null
    const caller = this.sessions.callerOf({ request })
    const now = Date.now()
    const holding = [
      caller.kind === CALLERS.ticket ? caller.unlockedUntil : null,
      this.cookieUntil({ request }),
    ].filter((until): until is number => until !== null && until > now)
    return holding.length === 0 ? null : Math.max(...holding)
  }

  private isUnlocked({ request }: { request: Request }): boolean {
    return this.unlockedUntil({ request }) !== null
  }

  /**
   * The expiry the unlock cookie is signed with, when it names this
   * caller's own account. A cookie from before it named an account has two
   * parts and counts for nothing.
   */
  private cookieUntil({ request }: { request: Request }): number | null {
    const parts =
      readCookie({ header: request.headers[AUTH_HEADERS.cookie], name: UNLOCK_COOKIE })?.split(
        '.',
      ) ?? []
    if (parts.length !== COOKIE_PARTS) return null
    const [expires = '', accountId = '', signature = ''] = parts
    const isSigned =
      sameSecret({ given: accountId, expected: this.accountIdOf({ request }) }) &&
      sameSecret({ given: signature, expected: this.sign(`${expires}.${accountId}`) })
    return isSigned ? Number(expires) : null
  }
}
