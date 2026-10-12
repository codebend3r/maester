import type { DatabaseService } from '@/db/database'
import { MediaRepository } from '@/media/mediaRepository'
import { ItemImagesRepository } from '@/metadata/itemImagesRepository'
import { MetadataRepository } from '@/metadata/metadataRepository'

/** The stores a test reads items and videos through, over one database, wired as the app wires them. */
export const repositories = (database: DatabaseService) => {
  const images = new ItemImagesRepository(database)
  const metadata = new MetadataRepository(database, images)
  return { images, metadata, media: new MediaRepository(database, metadata, images) }
}
