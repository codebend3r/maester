import { Inject, Injectable, Logger } from '@nestjs/common'
import { type AlbumMatchDiagnosis, isAlbumMatchDiagnosis } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import { errorMessage } from '@/errorMessage'
import { AlbumClaude } from '@/music/albumClaude'
import { AlbumMatching } from '@/music/albumMatching'
import type { AlbumToMatch } from '@/music/musicMatchStore'
import { factChecksOf, toCandidate } from '@/music/releaseScoring'

type KeptRow = { tags: string; diagnosis: string }

type KeptProps = { id: number; tags: string }

type KeepProps = { album: AlbumToMatch; tags: string; diagnosis: AlbumMatchDiagnosis }

/**
 * Why an album is unmatched, as the Unmatched albums tab shows it on
 * hover: the closest release its own searches find, each fact weighed
 * against it (`factChecksOf`), and smart match's reason and fix. Kept in
 * `album_diagnoses` until the album's tags change, so hovering again, on
 * any device and after a restart, asks neither MusicBrainz nor Claude. One
 * with no reason (no AI key, no lookups left, Claude failed) is not kept,
 * so it is asked again once Claude can answer; a failed search is not kept.
 * Two hovers at once share one ask.
 */
@Injectable()
export class AlbumDiagnoses {
  private readonly logger = new Logger(AlbumDiagnoses.name)
  private readonly asking = new Map<number, Promise<AlbumMatchDiagnosis>>()

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AlbumMatching) private readonly matching: Pick<AlbumMatching, 'closest'>,
    @Inject(AlbumClaude) private readonly claude: Pick<AlbumClaude, 'explain'>,
  ) {}

  async diagnose(album: AlbumToMatch): Promise<AlbumMatchDiagnosis> {
    const tags = JSON.stringify(album)
    const kept = this.kept({ id: album.id, tags })
    if (kept !== null) return kept
    const asked = this.asking.get(album.id) ?? this.ask(album)
    this.asking.set(album.id, asked)
    try {
      const diagnosis = await asked
      if (diagnosis.reason !== null) this.keep({ album, tags, diagnosis })
      return diagnosis
    } finally {
      this.asking.delete(album.id)
    }
  }

  private kept({ id, tags }: KeptProps): AlbumMatchDiagnosis | null {
    const row = this.database.db
      .prepare<[number], KeptRow>('SELECT tags, diagnosis FROM album_diagnoses WHERE album_id = ?')
      .get(id)
    if (row?.tags !== tags) return null
    return parseJsonAs({ json: row.diagnosis, guard: isAlbumMatchDiagnosis })
  }

  private keep({ album, tags, diagnosis }: KeepProps): void {
    this.database.db
      .prepare(
        `INSERT INTO album_diagnoses (album_id, tags, diagnosis) VALUES (?, ?, ?)
         ON CONFLICT (album_id) DO UPDATE SET tags = excluded.tags, diagnosis = excluded.diagnosis`,
      )
      .run(album.id, tags, JSON.stringify(diagnosis))
  }

  private async ask(album: AlbumToMatch): Promise<AlbumMatchDiagnosis> {
    const [best] = await this.matching.closest(album)
    const closest = best === undefined ? null : toCandidate(best)
    const facts = best === undefined ? [] : factChecksOf({ album, release: best.release })
    const explained = await this.claude
      .explain({ album, closest, facts })
      .catch((error: unknown) => {
        // The facts still say what differs, so a failed explanation is left out rather than failing them.
        this.logger.warn(`Could not explain album ${album.id}: ${errorMessage(error)}`)
        return null
      })
    return { closest, facts, reason: explained?.reason ?? null, fix: explained?.fix ?? null }
  }
}
