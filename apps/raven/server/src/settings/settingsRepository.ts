import { randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  type DisplaySettings,
  type PlaybackSettings,
  isDisplaySettings,
  type Guard,
  isAccountId,
  isPlaybackSettings,
  isRecord,
  isString,
  object,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'

export const SETTINGS_KEYS = {
  playback: 'playback',
  display: 'display',
  admin: 'admin',
  accounts: 'accounts',
  viewing: 'viewing',
} as const

/** The owner who took over the viewing recorded before accounts, and when. */
const isViewingRecord = object({ ownerId: isAccountId, adoptedAt: isString })

/** Server-wide settings, one JSON value per key, each read with its defaults filled in. */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  private stored({ key }: { key: string }): string | null {
    const row = this.db
      .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
      .get(key)
    return row?.value ?? null
  }

  private read({ key }: { key: string }): Record<string, unknown> | null {
    const json = this.stored({ key })
    return json === null ? null : parseJsonAs({ json, guard: isRecord })
  }

  private write({ key, value }: { key: string; value: unknown }): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value))
  }

  /** The stored value over the defaults, every field present; one that no longer reads falls back to the defaults. */
  private merged<T>({ key, defaults, guard }: { key: string; defaults: T; guard: Guard<T> }): T {
    const merged = { ...defaults, ...this.read({ key }) }
    return guard(merged) ? merged : defaults
  }

  /** How video is played. */
  playback(): PlaybackSettings {
    return this.merged({
      key: SETTINGS_KEYS.playback,
      defaults: DEFAULT_PLAYBACK_SETTINGS,
      guard: isPlaybackSettings,
    })
  }

  /** Changes the fields given and keeps the rest. */
  setPlayback(change: Partial<PlaybackSettings>): PlaybackSettings {
    const next: PlaybackSettings = { ...this.playback(), ...change }
    this.write({ key: SETTINGS_KEYS.playback, value: next })
    return next
  }

  /** How pages look: whether a movie's title shows as its logo. */
  display(): DisplaySettings {
    return this.merged({
      key: SETTINGS_KEYS.display,
      defaults: DEFAULT_DISPLAY_SETTINGS,
      guard: isDisplaySettings,
    })
  }

  /** Changes the fields given and keeps the rest. */
  setDisplay(change: Partial<DisplaySettings>): DisplaySettings {
    const next: DisplaySettings = { ...this.display(), ...change }
    this.write({ key: SETTINGS_KEYS.display, value: next })
    return next
  }

  /**
   * The secret the admin lock signs its cookies with: made the first time it
   * is asked for and kept from then on, so a restart or a redeploy leaves
   * every browser's admin lock as it was.
   */
  adminSecret(): string {
    const stored = this.read({ key: SETTINGS_KEYS.admin })?.secret ?? null
    if (isString(stored) && stored !== '') return stored
    const secret = randomBytes(32).toString('base64url')
    this.write({ key: SETTINGS_KEYS.admin, value: { secret } })
    return secret
  }

  /** When this server first ran with accounts ready, or null if it never has. */
  accountsEnforcedAt(): string | null {
    if (this.stored({ key: SETTINGS_KEYS.accounts }) === null) return null
    const stored = this.read({ key: SETTINGS_KEYS.accounts })?.enforcedAt ?? null
    // A row that no longer reads still means accounts were enforced: never fail open on damage.
    return isString(stored) && stored !== '' ? stored : new Date(0).toISOString()
  }

  /** Remembers the first start with accounts ready; later starts keep the first date. */
  markAccountsEnforced({ at }: { at: Date }): void {
    if (this.accountsEnforcedAt() !== null) return
    this.write({ key: SETTINGS_KEYS.accounts, value: { enforcedAt: at.toISOString() } })
  }

  /** Forgets the record, once the operator has opted out of accounts. */
  forgetAccountsEnforced(): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(SETTINGS_KEYS.accounts)
  }

  /** The owner who adopted the viewing from before accounts, or null if none has. */
  viewingOwner(): string | null {
    const stored = this.read({ key: SETTINGS_KEYS.viewing })
    return isViewingRecord(stored) ? stored.ownerId : null
  }

  /** Records the owner who adopted the viewing from before accounts. */
  markViewingOwner({ ownerId, at }: { ownerId: string; at: Date }): void {
    this.write({ key: SETTINGS_KEYS.viewing, value: { ownerId, adoptedAt: at.toISOString() } })
  }
}
