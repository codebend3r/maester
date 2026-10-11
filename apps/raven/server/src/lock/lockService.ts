import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { LockState } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { MediaRepository } from '@/media/mediaRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** What a route's `:id` names, so its library can be found: a library, a video, or a movie or show. */
export type Privacy = 'library' | 'media' | 'item'

export const PRIVACIES: readonly Privacy[] = ['library', 'media', 'item']

/** What one request may see of the locked libraries. */
export type Viewer = {
  /** A library's videos show when it is not locked, or this browser has unlocked it. */
  seesLibrary: (libraryId: number) => boolean
  /** A movie or show shows when a library it may show from holds a file of it. */
  seesItem: (itemId: number) => boolean
  /** Whether what a route's id names may show; an id that names nothing is the route's to refuse. */
  sees: (args: { privacy: Privacy; id: number }) => boolean
}

/** How unlocking went: a cookie to set, or why not with the status to say it with. */
export type Unlocking =
  | { ok: true; cookie: string }
  | { ok: false; status: 401 | 429 | 503; message: string }

const COOKIE = 'raven_unlock'
/** An unlocked browser stays so this long, or until it locks again or the server restarts. */
const SESSION_MS = 12 * 60 * 60_000
/** Wrong PINs in a row before unlocking waits, since four digits are quickly tried. */
const TRIES = 5
const WAIT_MS = 60_000

/** With nothing locked, or the PIN entered: everything shows, and nothing more is looked up. */
const EVERYTHING: Viewer = { seesLibrary: () => true, seesItem: () => true, sees: () => true }

const digest = (text: string): Buffer => createHash('sha256').update(text).digest()

const cookieValue = (header: string | undefined): string | null =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1) ?? null

/**
 * Keeps locked libraries behind the server's PIN. Entering it gives the
 * browser a session cookie signed with a key that lives only as long as
 * the process. Without a PIN set, locked libraries stay shut: forgetting
 * the setting never opens them.
 */
@Injectable()
export class LockService {
  private readonly key = randomBytes(32)
  private readonly tries = { failed: 0, waitUntil: 0 }

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
  ) {}

  get available(): boolean {
    return this.config.libraryPin != null
  }

  state({ cookie }: { cookie: string | undefined }): LockState {
    return { available: this.available, unlocked: this.isUnlocked(cookie) }
  }

  unlock(pin: string): Unlocking {
    const expected = this.config.libraryPin
    if (expected == null) {
      return { ok: false, status: 503, message: "Set LIBRARY_PIN in raven's .env to unlock." }
    }
    if (Date.now() < this.tries.waitUntil) {
      return { ok: false, status: 429, message: 'Too many wrong PINs. Try again in a minute.' }
    }
    if (!timingSafeEqual(digest(pin), digest(expected))) {
      this.tries.failed += 1
      if (this.tries.failed >= TRIES) {
        this.tries.failed = 0
        this.tries.waitUntil = Date.now() + WAIT_MS
      }
      return { ok: false, status: 401, message: 'That PIN is not right.' }
    }
    this.tries.failed = 0
    const expires = String(Date.now() + SESSION_MS)
    return { ok: true, cookie: `${COOKIE}=${expires}.${this.sign(expires)}; ${this.attributes()}` }
  }

  /** The cookie that forgets the session. */
  lockCookie(): string {
    return `${COOKIE}=; Max-Age=0; ${this.attributes()}`
  }

  viewer({ cookie }: { cookie: string | undefined }): Viewer {
    const locked = this.libraries.lockedIds()
    if (locked.size === 0 || this.isUnlocked(cookie)) return EVERYTHING
    const seesLibrary = (libraryId: number): boolean => !locked.has(libraryId)
    const seesItem = (itemId: number): boolean => {
      const holding = this.metadata.librariesHolding(itemId)
      return holding.length === 0 || holding.some(seesLibrary)
    }
    const sees = ({ privacy, id }: { privacy: Privacy; id: number }): boolean => {
      switch (privacy) {
        case 'library':
          return seesLibrary(id)
        case 'media': {
          const libraryId = this.media.libraryOf(id)
          return libraryId == null || seesLibrary(libraryId)
        }
        case 'item':
          return seesItem(id)
        default: {
          const unknown: never = privacy
          return unknown
        }
      }
    }
    return { seesLibrary, seesItem, sees }
  }

  /** Scoped to the API, out of reach of scripts, and never sent from another site. */
  private attributes(): string {
    return 'Path=/api; HttpOnly; SameSite=Strict'
  }

  private sign(expires: string): string {
    return createHmac('sha256', this.key).update(expires).digest('base64url')
  }

  private isUnlocked(cookie: string | undefined): boolean {
    const [expires = '', signature = ''] = cookieValue(cookie)?.split('.') ?? []
    const expected = this.sign(expires)
    return (
      Number(expires) > Date.now() &&
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
  }
}
