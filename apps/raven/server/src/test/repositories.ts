import type { DatabaseService } from '@/db/database'
import { MediaRepository } from '@/media/mediaRepository'
import { SagaBackdrops } from '@/media/sagaBackdrops'
import { type AccountKey, VIEWING_ACCOUNTS } from '@/media/viewingAccountKeys'
import type { AdoptedCounts } from '@/media/viewingAdoption'
import { ItemImagesRepository } from '@/metadata/itemImagesRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { PictureVersions } from '@/metadata/pictureVersions'
import { PeopleRepository } from '@/people/peopleRepository'
import { SettingsRepository } from '@/settings/settingsRepository'

/** Two accounts a repository test views as: the one a server without accounts keeps, and another. */
export const TEST_ACCOUNTS = {
  a: VIEWING_ACCOUNTS.local,
  b: '30000000-0000-4000-8000-000000000002',
} as const

/** The keyed picture versions over `database`'s own secret, as the app makes them. */
export const pictureVersionsOf = (database: DatabaseService): PictureVersions =>
  new PictureVersions(new SettingsRepository(database))

/** The people store over `database`, wired as the app wires it. */
export const peopleRepositoryOf = (database: DatabaseService): PeopleRepository =>
  new PeopleRepository(database, pictureVersionsOf(database))

/** The stores a test reads items and videos through, over one database, wired as the app wires them. */
export const repositories = (database: DatabaseService) => {
  const pictureVersions = pictureVersionsOf(database)
  const images = new ItemImagesRepository(database, pictureVersions)
  const metadata = new MetadataRepository(database, images, pictureVersions)
  const sagaBackdrops = new SagaBackdrops(database)
  return {
    images,
    metadata,
    sagaBackdrops,
    media: new MediaRepository(database, metadata, images, sagaBackdrops),
  }
}

type ViewingCountsOfProps = {
  database: DatabaseService
  account: AccountKey
}

/** How many spots, plays, video favourites and title favourites `account` holds. */
export const viewingCountsOf = ({
  database,
  account,
}: ViewingCountsOfProps): AdoptedCounts | undefined =>
  database.db
    .prepare<{ account: AccountKey }, AdoptedCounts>(
      `SELECT
         (SELECT COUNT(*) FROM playback_progress WHERE account_id = @account) AS spots,
         (SELECT COUNT(*) FROM plays WHERE account_id = @account) AS plays,
         (SELECT COUNT(*) FROM favourites WHERE account_id = @account) AS favourites,
         (SELECT COUNT(*) FROM item_favourites WHERE account_id = @account) AS titleFavourites`,
    )
    .get({ account })
