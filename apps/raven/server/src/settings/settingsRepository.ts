import { Inject, Injectable } from '@nestjs/common'
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  type DisplaySettings,
  type PlaybackSettings,
  isDisplaySettings,
  type Guard,
  isPlaybackSettings,
  isRecord,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'

/** Server-wide settings, one JSON value per key, each read with its defaults filled in. */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  private read(key: string): Record<string, unknown> | null {
    const row = this.db
      .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
      .get(key)
    return row ? parseJsonAs({ json: row.value, guard: isRecord }) : null
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
    const merged = { ...defaults, ...this.read(key) }
    return guard(merged) ? merged : defaults
  }

  /** How video is played. */
  playback(): PlaybackSettings {
    return this.merged({
      key: 'playback',
      defaults: DEFAULT_PLAYBACK_SETTINGS,
      guard: isPlaybackSettings,
    })
  }

  /** Changes the fields given and keeps the rest. */
  setPlayback(change: Partial<PlaybackSettings>): PlaybackSettings {
    const next: PlaybackSettings = { ...this.playback(), ...change }
    this.write({ key: 'playback', value: next })
    return next
  }

  /** How pages look: whether a movie's title shows as its logo. */
  display(): DisplaySettings {
    return this.merged({
      key: 'display',
      defaults: DEFAULT_DISPLAY_SETTINGS,
      guard: isDisplaySettings,
    })
  }

  /** Changes the fields given and keeps the rest. */
  setDisplay(change: Partial<DisplaySettings>): DisplaySettings {
    const next: DisplaySettings = { ...this.display(), ...change }
    this.write({ key: 'display', value: next })
    return next
  }
}
