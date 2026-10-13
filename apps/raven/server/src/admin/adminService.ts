import { createHmac, randomBytes } from 'node:crypto'
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import type { AdminLock } from '@raven/core'
import { readCookie, sameSecret } from '@shared/server'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { WrongTries } from '@/lock/wrongTries'

/** How turning the admin lock off went: a cookie to set, or why not with the status to say it with. */
export type AdminUnlocking =
  | { ok: true; cookie: string }
  | { ok: false; status: 401 | 429 | 503; message: string }

/** A change to this browser's session: the cookie that carries it, and the lock as it then stands. */
export type AdminChange = { cookie: string; lock: AdminLock }

/**
 * A browser's session with the lock off: when it ends, and, once the lock
 * was turned back on, when it holds again. Null `locksAt` is a lock left off.
 */
type Session = { endsAt: number; locksAt: number | null }

const COOKIE = 'raven_admin'
/** The lock stays off this long after the password, or until it is turned on or the server restarts. */
const SESSION_MS = 12 * 60 * 60_000
/** Turned on, the lock waits this long, so a slip of the finger is undone without the password. */
export const TURN_ON_DELAY_MS = 15_000

const MIN_LENGTH = 10
const CHARACTER_KINDS = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/]

/** Long enough, with lower and upper case letters, a digit and a symbol. */
export const isStrongPassword = (password: string): boolean =>
  password.length >= MIN_LENGTH && CHARACTER_KINDS.every((kind) => kind.test(password))

const NO_PASSWORD = "Set ADMIN_PASSWORD in raven's .env to turn the admin lock off."
const WEAK_PASSWORD = `ADMIN_PASSWORD in raven's .env is too weak to turn the admin lock off: use ${MIN_LENGTH} characters or more, with lower and upper case letters, a digit and a symbol.`

/**
 * The admin lock: on for every browser until the admin password is entered
 * there. While it holds, locked libraries are left out altogether, nothing
 * is managed (the routes marked `AdminOnly`), no video can be deleted, and
 * no file's path is handed out. Entering the password gives the browser a
 * session cookie signed with a key that lives only as long as the process,
 * so a restart turns the lock back on everywhere.
 * Without a strong password set the lock stays on: forgetting the setting
 * never opens anything.
 */
@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name)
  private readonly key = randomBytes(32)
  private readonly tries = new WrongTries()

  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  onModuleInit(): void {
    if (this.config.adminPassword != null && !this.available) this.logger.warn(WEAK_PASSWORD)
  }

  /** Whether the lock can be turned off: a password is set, and strong enough. */
  get available(): boolean {
    const password = this.config.adminPassword
    return password != null && isStrongPassword(password)
  }

  isLocked({ cookie }: { cookie: string | undefined }): boolean {
    return this.session(cookie) == null
  }

  state({ cookie }: { cookie: string | undefined }): AdminLock {
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
    return { ok: true, cookie: this.cookieOf({ endsAt: Date.now() + SESSION_MS, locksAt: null }) }
  }

  /**
   * Turns the lock back on once `TURN_ON_DELAY_MS` has passed. Null when it
   * holds already, or is on its way, whose wait is not drawn out again.
   */
  lock({ cookie }: { cookie: string | undefined }): AdminChange | null {
    const session = this.session(cookie)
    if (session == null || session.locksAt != null) return null
    return this.change({ ...session, locksAt: Date.now() + TURN_ON_DELAY_MS })
  }

  /** Takes back a lock on its way, with no password. Null once it holds, when only the password opens it. */
  keepUnlocked({ cookie }: { cookie: string | undefined }): AdminChange | null {
    const session = this.session(cookie)
    if (session == null) return null
    return this.change({ ...session, locksAt: null })
  }

  private lockOf(session: Session): AdminLock {
    if (session.locksAt == null) return { state: 'off' }
    const holdsAt = Math.min(session.locksAt, session.endsAt)
    return { state: 'turningOn', remainingMs: Math.max(0, holdsAt - Date.now()) }
  }

  private change(session: Session): AdminChange {
    return { cookie: this.cookieOf(session), lock: this.lockOf(session) }
  }

  /** Scoped to the API, out of reach of scripts, and never sent from another site. */
  private cookieOf({ endsAt, locksAt }: Session): string {
    const value = `${endsAt}.${locksAt ?? ''}`
    return `${COOKIE}=${value}.${this.sign(value)}; Path=/api; HttpOnly; SameSite=Strict`
  }

  private sign(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('base64url')
  }

  /** This browser's session while the lock is off for it, else null. */
  private session(cookie: string | undefined): Session | null {
    const [endsAt = '', locksAt = '', signature = ''] =
      readCookie({ header: cookie, name: COOKIE })?.split('.') ?? []
    if (!sameSecret({ given: signature, expected: this.sign(`${endsAt}.${locksAt}`) })) return null
    const session = { endsAt: Number(endsAt), locksAt: locksAt === '' ? null : Number(locksAt) }
    const holdsAt = Math.min(session.endsAt, session.locksAt ?? Number.POSITIVE_INFINITY)
    return holdsAt > Date.now() ? session : null
  }
}
