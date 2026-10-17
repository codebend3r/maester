import { createHmac, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { LockState } from '@raven/core'
import { readCookie, sameSecret } from '@shared/server'
import { AdminService } from '@/admin/adminService'
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
  /** A library shows at all, by its name and type, unless it is locked while the admin lock holds. */
  listsLibrary: (libraryId: number) => boolean
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
 * the process. Without a PIN set, locked libraries stay shut: forgetting
 * the setting never opens them. While the admin lock holds, the PIN opens
 * nothing either, and locked libraries are left out altogether.
 */
@Injectable()
export class LockService {
  private readonly key = randomBytes(32)
  private readonly tries = new WrongTries()

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(AdminService) private readonly admin: AdminService,
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
    if (this.tries.isWaiting) {
      return { ok: false, status: 429, message: 'Too many wrong PINs. Try again in a minute.' }
    }
    if (!sameSecret({ given: pin, expected })) {
      this.tries.fail()
      return { ok: false, status: 401, message: 'That PIN is not right.' }
    }
    this.tries.succeed()
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
    const isHidden = this.admin.isLocked({ cookie })
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

  private sign(expires: string): string {
    return createHmac('sha256', this.key).update(expires).digest('base64url')
  }

  /** Whether this browser entered the PIN, and the admin lock lets it count. */
  private isUnlocked(cookie: string | undefined): boolean {
    if (this.admin.isLocked({ cookie })) return false
    const [expires = '', signature = ''] =
      readCookie({ header: cookie, name: COOKIE })?.split('.') ?? []
    return (
      Number(expires) > Date.now() && sameSecret({ given: signature, expected: this.sign(expires) })
    )
  }
}
