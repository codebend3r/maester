import { Inject, Injectable } from '@nestjs/common'
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackSettings, isPlaybackSettings } from '@raven/core'
import { DatabaseService } from '@/db/database'

/** Server-wide settings, one JSON value per key, each read with its defaults filled in. */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  private read(key: string): unknown {
    const row = this.db
      .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
      .get(key)
    if (!row) return null
    try {
      const parsed: unknown = JSON.parse(row.value)
      return parsed
    } catch {
      return null
    }
  }

  /** How video is played, every field present; a stored value that no longer reads falls back to the default. */
  playback(): PlaybackSettings {
    const stored = this.read('playback')
    const merged = {
      ...DEFAULT_PLAYBACK_SETTINGS,
      ...(stored != null && typeof stored === 'object' ? stored : {}),
    }
    return isPlaybackSettings(merged) ? merged : DEFAULT_PLAYBACK_SETTINGS
  }

  /** Changes the fields given and keeps the rest. */
  setPlayback(change: Partial<PlaybackSettings>): PlaybackSettings {
    const next: PlaybackSettings = { ...this.playback(), ...change }
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('playback', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(JSON.stringify(next))
    return next
  }
}
