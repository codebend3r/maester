import { type DynamicModule, Module } from '@nestjs/common'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { BrowseController } from '@/fs/browseController'
import { HealthController } from '@/health/healthController'
import { ItemsController } from '@/items/itemsController'
import { MatchController } from '@/items/matchController'
import { PeopleController } from '@/items/peopleController'
import { ReviewsController } from '@/items/reviewsController'
import { LibrariesController } from '@/libraries/librariesController'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FavouritesController } from '@/media/favouritesController'
import { MediaController } from '@/media/mediaController'
import { MediaRepository } from '@/media/mediaRepository'
import { ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { OmdbClient } from '@/metadata/omdbClient'
import { METADATA_FETCH, type MetadataFetch, TmdbClient } from '@/metadata/tmdbClient'
import { PlaybackController } from '@/playback/playbackController'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { ScannerService } from '@/scanner/scannerService'
import { SettingsController } from '@/settings/settingsController'
import { SettingsRepository } from '@/settings/settingsRepository'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/**
 * Takes its config as an argument so a test can point it at a temporary data
 * dir, and the fetch metadata uses so a test can answer for TMDB.
 */
@Module({})
export class AppModule {
  static register({
    config,
    metadataFetch = (url, init) => fetch(url, init),
  }: {
    config: ServerConfig
    metadataFetch?: MetadataFetch
  }): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        LibrariesController,
        MediaController,
        PlaybackController,
        FavouritesController,
        BrowseController,
        HealthController,
        ItemsController,
        MatchController,
        PeopleController,
        ReviewsController,
        SettingsController,
      ],
      providers: [
        { provide: SERVER_CONFIG, useValue: config },
        { provide: METADATA_FETCH, useValue: metadataFetch },
        DatabaseService,
        LibrariesRepository,
        SettingsRepository,
        MetadataRepository,
        MediaRepository,
        TmdbClient,
        OmdbClient,
        ImageCache,
        MetadataService,
        FfmpegService,
        ThumbnailService,
        TracksService,
        SubtitlesService,
        ScannerService,
      ],
    }
  }
}
