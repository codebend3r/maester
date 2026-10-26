import { Inject, Injectable } from '@nestjs/common'
import { DatabaseService } from '@/db/database'

type HeroRepositoryAddProps = { itemId: number }

type HeroRepositoryRemoveProps = { itemId: number }

/** The movies and shows the admin picked for home's hero, in the order they were picked. */
@Injectable()
export class HeroRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  picks(): number[] {
    return this.db
      .prepare<[], { item_id: number }>(
        'SELECT item_id FROM hero_picks ORDER BY picked_at, item_id',
      )
      .all()
      .map((row) => row.item_id)
  }

  /** Adds the item, keeping the place it already has; a second add changes nothing. */
  add({ itemId }: HeroRepositoryAddProps): void {
    this.db
      .prepare('INSERT OR IGNORE INTO hero_picks (item_id, picked_at) VALUES (?, ?)')
      .run(itemId, new Date().toISOString())
  }

  remove({ itemId }: HeroRepositoryRemoveProps): void {
    this.db.prepare('DELETE FROM hero_picks WHERE item_id = ?').run(itemId)
  }
}
