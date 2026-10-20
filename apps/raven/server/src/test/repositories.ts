import type { DatabaseService } from '@/db/database'
import { MediaRepository } from '@/media/mediaRepository'
import { SagaBackdrops } from '@/media/sagaBackdrops'
import { type AccountKey, VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import type { AdoptedCounts } from '@/media/viewingAdoption'
import { ItemImagesRepository } from '@/metadata/itemImagesRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** Two accounts a repository test views as: the one a server without accounts keeps, and another. */
export const TEST_ACCOUNTS = {
  a: VIEWING_ACCOUNTS.local,
  b: '30000000-0000-4000-8000-000000000002',
} as const

/** The stores a test reads items and videos through, over one database, wired as the app wires them. */
export const repositories = (database: DatabaseService) => {
  const images = new ItemImagesRepository(database)
  const metadata = new MetadataRepository(database, images)
  const sagaBackdrops = new SagaBackdrops(database)
  return {
    images,
    metadata,
    sagaBackdrops,
    media: new MediaRepository(database, metadata, images, sagaBackdrops),
  }
}

/** How many spots, plays, video favourites and title favourites `account` holds. */
export const viewingCountsOf = ({
  database,
  account,
}: {
  database: DatabaseService
  account: AccountKey
}): AdoptedCounts | undefined =>
  database.db
    .prepare<{ account: AccountKey }, AdoptedCounts>(
      `SELECT
         (SELECT COUNT(*) FROM playback_progress WHERE account_id = @account) AS spots,
         (SELECT COUNT(*) FROM plays WHERE account_id = @account) AS plays,
         (SELECT COUNT(*) FROM favourites WHERE account_id = @account) AS favourites,
         (SELECT COUNT(*) FROM item_favourites WHERE account_id = @account) AS titleFavourites`,
    )
    .get({ account })
