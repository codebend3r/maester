import { type DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { EventsController } from '@/events/eventsController'
import { ServerEvents } from '@/events/serverEvents'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { BrowseController } from '@/fs/browseController'
import { HealthController } from '@/health/healthController'
import { ItemsController } from '@/items/itemsController'
import { MatchController } from '@/items/matchController'
import { PeopleController } from '@/items/peopleController'
import { ReviewsController } from '@/items/reviewsController'
import { LibrariesController } from '@/libraries/librariesController'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { LockController } from '@/lock/lockController'
import { LockGuard } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { FavouritesController } from '@/media/favouritesController'
import { MediaController } from '@/media/mediaController'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaRepository } from '@/media/mediaRepository'
import { ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { OmdbClient } from '@/metadata/omdbClient'
import { METADATA_FETCH, type MetadataFetch, TmdbClient } from '@/metadata/tmdbClient'
import { PlaybackController } from '@/playback/playbackController'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { watchFolder } from '@/scanner/folderWatch'
import { LibraryWatcher, WATCH_OPTIONS, type WatchOptions } from '@/scanner/libraryWatcher'
import { ScannerService } from '@/scanner/scannerService'
import { SettingsController } from '@/settings/settingsController'
import { SettingsRepository } from '@/settings/settingsRepository'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/** Folders stay still for 2 s before a refresh; a library that cannot be watched is scanned every 10 min. */
const DEFAULT_WATCH: WatchOptions = {
  watchFolder,
  quietMs: 2_000,
  fallbackScanMs: 10 * 60_000,
}

/**
 * Takes its config as an argument so a test can point it at a temporary data
 * dir, the fetch metadata uses so a test can answer for TMDB, and the
 * watcher's timing so a test need not wait.
 */
@Module({})
export class AppModule {
  static register({
    config,
    metadataFetch = (url, init) => fetch(url, init),
    watch = {},
  }: {
    config: ServerConfig
    metadataFetch?: MetadataFetch
    watch?: Partial<WatchOptions>
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
        EventsController,
        LockController,
      ],
      providers: [
        { provide: SERVER_CONFIG, useValue: config },
        { provide: METADATA_FETCH, useValue: metadataFetch },
        { provide: WATCH_OPTIONS, useValue: { ...DEFAULT_WATCH, ...watch } },
        DatabaseService,
        ServerEvents,
        LibrariesRepository,
        SettingsRepository,
        MetadataRepository,
        MediaRepository,
        MediaIndex,
        TmdbClient,
        OmdbClient,
        ImageCache,
        MetadataService,
        FfmpegService,
        ThumbnailService,
        TracksService,
        SubtitlesService,
        ScannerService,
        LibraryWatcher,
        LockService,
        // Every route passes the lock first; only those marked PrivateBy are held.
        { provide: APP_GUARD, useClass: LockGuard },
      ],
    }
  }
}
