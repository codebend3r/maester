import { createHmac } from 'node:crypto'
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { type AdminLock, SERVER_COOKIES } from '@raven/core'
import { readCookie, sameSecret } from '@shared/server'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { WrongTries } from '@/lock/wrongTries'
import { SettingsRepository } from '@/settings/settingsRepository'

/** How turning the admin lock off went: a cookie to set, or why not with the status to say it with. */
export type AdminUnlocking =
  | { ok: true; cookie: string }
  | { ok: false; status: 401 | 429 | 503; message: string }

/** A change to this browser's session: the cookie that carries it, and the lock as it then stands. */
export type AdminChange = { cookie: string; lock: AdminLock }

/**
 * A browser's session with the lock off: when the password was entered,
 * and, once the lock was turned back on, when it holds again. Null
 * `locksAt` is a lock left off, which it stays until it is turned back on.
 */
type Session = { since: number; locksAt: number | null }

/**
 * How long the browser keeps the cookie: 400 days, the most Chrome allows.
 * Each read of the lock renews it, so a browser that comes back keeps it.
 */
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60
/** Turned on, the lock waits this long, so a slip of the finger is undone without the password. */
export const TURN_ON_DELAY_MS = 15_000

const MIN_LENGTH = 10
const CHARACTER_KINDS = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/]

/** Long enough, with lower and upper case letters, a digit and a symbol. */
export const isStrongPassword = (password: string): boolean =>
  password.length >= MIN_LENGTH && CHARACTER_KINDS.every((kind) => kind.test(password))

const NO_PASSWORD = "Set ADMIN_PASSWORD in raven's .env to turn the admin lock off."
const WEAK_PASSWORD = `ADMIN_PASSWORD in raven's .env is too weak to turn the admin lock off: use ${MIN_LENGTH} characters or more, with lower and upper case letters, a digit and a symbol.`

type AdminServiceIsLockedProps = { cookie: string | undefined }

type AdminServiceStateProps = { cookie: string | undefined }

type AdminServiceLockProps = { cookie: string | undefined }

type AdminServiceRenewedProps = { cookie: string | undefined }

type AdminServiceKeepUnlockedProps = { cookie: string | undefined }

/**
 * The admin lock: on for every browser until the admin password is entered
 * there. While it holds, locked libraries are left out altogether, and the
 * routes marked `AdminOnly` are held back, as every route that is not a GET
 * is unless it is marked `ForViewers`. Entering the password gives the
 * browser a session cookie that keeps the lock off there until it is turned
 * back on, through refreshes, restarts and redeploys. The cookie is signed
 * with a key made from a secret kept in the database and the password
 * itself, so changing `ADMIN_PASSWORD` turns the lock back on everywhere.
 * Without a strong password set the lock stays on: forgetting the setting
 * never opens anything.
 */
@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name)
  private readonly key: Buffer
  private readonly tries = new WrongTries()

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(SettingsRepository) settings: SettingsRepository,
  ) {
    this.key = createHmac('sha256', settings.adminSecret())
      .update(config.adminPassword ?? '')
      .digest()
  }

  onModuleInit(): void {
    if (this.config.adminPassword != null && !this.available) this.logger.warn(WEAK_PASSWORD)
  }

  /** Whether the lock can be turned off: a password is set, and strong enough. */
  get available(): boolean {
    const password = this.config.adminPassword
    return password != null && isStrongPassword(password)
  }

  isLocked({ cookie }: AdminServiceIsLockedProps): boolean {
    return this.session(cookie) == null
  }

  state({ cookie }: AdminServiceStateProps): AdminLock {
    const session = this.session(cookie)
    if (session == null) return { state: 'on', available: this.available }
    return this.lockOf(session)
  }

  unlock(password: string): AdminUnlocking {
    const expected = this.config.adminPassword
    if (expected == null) return { ok: false, status: 503, message: NO_PASSWORD }
    if (!isStrongPassword(expected)) return { ok: false, status: 503, message: WEAK_PASSWORD }
    if (this.tries.isWaiting) {
      return { ok: false, status: 429, message: 'Too many wrong passwords. Try again in a minute.' }
    }
    if (!sameSecret({ given: password, expected })) {
      this.tries.fail()
      return { ok: false, status: 401, message: 'That password is not right.' }
    }
    this.tries.succeed()
    return { ok: true, cookie: this.cookieOf({ since: Date.now(), locksAt: null }) }
  }

  /**
   * Turns the lock back on once `TURN_ON_DELAY_MS` has passed. Null when it
   * holds already, or is on its way, whose wait is not drawn out again.
   */
  lock({ cookie }: AdminServiceLockProps): AdminChange | null {
    const session = this.session(cookie)
    if (session == null || session.locksAt != null) return null
    return this.change({ ...session, locksAt: Date.now() + TURN_ON_DELAY_MS })
  }

  /** The session's cookie again, for another 400 days in the browser; null when the lock holds. */
  renewed({ cookie }: AdminServiceRenewedProps): AdminChange | null {
    const session = this.session(cookie)
    return session == null ? null : this.change(session)
  }

  /** Takes back a lock on its way, with no password. Null once it holds, when only the password opens it. */
  keepUnlocked({ cookie }: AdminServiceKeepUnlockedProps): AdminChange | null {
    const session = this.session(cookie)
    if (session == null) return null
    return this.change({ ...session, locksAt: null })
  }

  private lockOf(session: Session): AdminLock {
    if (session.locksAt == null) return { state: 'off' }
    return { state: 'turningOn', remainingMs: Math.max(0, session.locksAt - Date.now()) }
  }

  private change(session: Session): AdminChange {
    return { cookie: this.cookieOf(session), lock: this.lockOf(session) }
  }

  /** Scoped to the API, out of reach of scripts, never sent from another site, and kept when the browser closes. */
  private cookieOf({ since, locksAt }: Session): string {
    const value = `${since}.${locksAt ?? ''}`
    return `${SERVER_COOKIES.admin}=${value}.${this.sign(value)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}`
  }

  private sign(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('base64url')
  }

  /** This browser's session while the lock is off for it, else null. */
  private session(cookie: string | undefined): Session | null {
    const [since = '', locksAt = '', signature = ''] =
      readCookie({ header: cookie, name: SERVER_COOKIES.admin })?.split('.') ?? []
    if (!sameSecret({ given: signature, expected: this.sign(`${since}.${locksAt}`) })) return null
    const session = { since: Number(since), locksAt: locksAt === '' ? null : Number(locksAt) }
    return session.locksAt == null || session.locksAt > Date.now() ? session : null
  }
}
