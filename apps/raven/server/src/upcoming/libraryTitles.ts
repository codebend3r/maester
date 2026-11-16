import { Inject, Injectable } from '@nestjs/common'
import { type TitleRequestAsk, requestKeyOf } from '@raven/core'
import { DatabaseService } from '@/db/database'

/** Which movies and shows raven holds already, by their TMDB ids. */
@Injectable()
export class LibraryTitles {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** The titles of `asks` some library holds, as core's `requestKeyOf` keys. */
  heldOf(asks: readonly TitleRequestAsk[]): Set<string> {
    const statement = this.database.db.prepare<[string, string], { held: number }>(
      'SELECT 1 AS held FROM items WHERE type = ? AND tmdb_id = ? LIMIT 1',
    )
    return new Set(
      asks
        .filter(({ type, tmdbId }) => statement.get(type, tmdbId) !== undefined)
        .map(requestKeyOf),
    )
  }
}
