import { Inject, Injectable } from '@nestjs/common'
import { DEFAULT_SAGA_BACKDROP, type SagaBackdrop, isSagaBackdrop } from '@raven/core'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'

/** What each library's saga pages show behind their titles. */
@Injectable()
export class SagaBackdrops {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** The backdrop each of a library's sagas picked, by the saga's TMDB id; one not here never picked. */
  ofLibrary(libraryId: number): Map<string, SagaBackdrop> {
    return new Map(
      this.db
        .prepare<[number], { saga_tmdb_id: string; backdrop: string }>(
          'SELECT saga_tmdb_id, backdrop FROM saga_backdrops WHERE library_id = ?',
        )
        .all(libraryId)
        .map((row) => [
          row.saga_tmdb_id,
          // One that no longer reads as a backdrop shows the default.
          parseJsonAs({ json: row.backdrop, guard: isSagaBackdrop }) ?? DEFAULT_SAGA_BACKDROP,
        ]),
    )
  }

  save({
    libraryId,
    sagaId,
    backdrop,
  }: {
    libraryId: number
    sagaId: string
    backdrop: SagaBackdrop
  }): void {
    this.db
      .prepare(
        `INSERT INTO saga_backdrops (library_id, saga_tmdb_id, backdrop) VALUES (?, ?, ?)
         ON CONFLICT (library_id, saga_tmdb_id) DO UPDATE SET backdrop = excluded.backdrop`,
      )
      .run(libraryId, sagaId, JSON.stringify(backdrop))
  }
}
