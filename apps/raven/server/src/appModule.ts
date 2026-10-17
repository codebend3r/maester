import { type DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AdminController } from '@/admin/adminController'
import { AdminGuard } from '@/admin/adminGuard'
import { AdminService } from '@/admin/adminService'
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
import { HomeController } from '@/media/homeController'
import { MediaArtifacts } from '@/media/mediaArtifacts'
import { MediaController } from '@/media/mediaController'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaOriginsController } from '@/media/mediaOriginsController'
import { MediaRepository } from '@/media/mediaRepository'
import { MediaTickets } from '@/media/mediaTickets'
import { SagaBackdrops } from '@/media/sagaBackdrops'
import { MovieSplits } from '@/media/movieSplits'
import { ViewingRepository } from '@/media/viewingRepository'
import { WatchedCards } from '@/media/watchedCards'
import { WatchedController } from '@/media/watchedController'
import { WatchedRepository } from '@/media/watchedRepository'
import { AI_FETCH, AiClient, type AiFetch } from '@/metadata/aiClient'
import { AiDecisions } from '@/metadata/aiDecisions'
import { AiMatcher } from '@/metadata/aiMatcher'
import { ImageCache } from '@/metadata/imageCache'
import { ItemImagesRepository } from '@/metadata/itemImagesRepository'
import { ItemOverrides } from '@/metadata/itemOverrides'
import { ItemPictures } from '@/metadata/itemPictures'
import { ItemRefresher } from '@/metadata/itemRefresher'
import { MatchFactsCache } from '@/metadata/matchFactsCache'
import { MatchFiles } from '@/metadata/matchFiles'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { OmdbClient } from '@/metadata/omdbClient'
import { OmdbScores } from '@/metadata/omdbScores'
import { METADATA_FETCH, type MetadataFetch, TmdbClient } from '@/metadata/tmdbClient'
import { PlaybackController } from '@/playback/playbackController'
import { SubtitlesService } from '@/playback/subtitlesService'
import { TracksService } from '@/playback/tracksService'
import { assertRoutesMarked } from '@/routeMarks'
import { watchFolder } from '@/scanner/folderWatch'
import { LibraryWatcher, WATCH_OPTIONS, type WatchOptions } from '@/scanner/libraryWatcher'
import { ScannerService } from '@/scanner/scannerService'
import { SettingsController } from '@/settings/settingsController'
import { SettingsRepository } from '@/settings/settingsRepository'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

export const CONTROLLERS = [
  LibrariesController,
  MediaController,
  MediaOriginsController,
  PlaybackController,
  FavouritesController,
  WatchedController,
  HomeController,
  BrowseController,
  HealthController,
  ItemsController,
  MatchController,
  PeopleController,
  ReviewsController,
  SettingsController,
  EventsController,
  LockController,
  AdminController,
] as const

/** Folders stay still for 2 s before a refresh. */
const DEFAULT_WATCH: WatchOptions = {
  watchFolder,
  quietMs: 2_000,
}

/**
 * Takes its config as an argument so a test can point it at a temporary data
 * dir, the fetches metadata and the AI lookup use so a test can answer for TMDB and Claude, and the
 * watcher's timing so a test need not wait.
 */
@Module({})
export class AppModule {
  static register({
    config,
    metadataFetch = (url, init) => fetch(url, init),
    aiFetch = (input, init) => fetch(input, init),
    watch = {},
  }: {
    config: ServerConfig
    metadataFetch?: MetadataFetch
    aiFetch?: AiFetch
    watch?: Partial<WatchOptions>
  }): DynamicModule {
    assertRoutesMarked(CONTROLLERS)
    return {
      module: AppModule,
      controllers: [...CONTROLLERS],
      providers: [
        { provide: SERVER_CONFIG, useValue: config },
        { provide: METADATA_FETCH, useValue: metadataFetch },
        { provide: AI_FETCH, useValue: aiFetch },
        { provide: WATCH_OPTIONS, useValue: { ...DEFAULT_WATCH, ...watch } },
        DatabaseService,
        ServerEvents,
        LibrariesRepository,
        SettingsRepository,
        ItemImagesRepository,
        MetadataRepository,
        ItemOverrides,
        SagaBackdrops,
        MediaRepository,
        MovieSplits,
        ViewingRepository,
        WatchedCards,
        WatchedRepository,
        MediaIndex,
        MatchFiles,
        AiDecisions,
        TmdbClient,
        MatchFactsCache,
        OmdbClient,
        AiClient,
        AiMatcher,
        ImageCache,
        OmdbScores,
        ItemPictures,
        MetadataService,
        ItemRefresher,
        FfmpegService,
        ThumbnailService,
        TracksService,
        SubtitlesService,
        MediaArtifacts,
        ScannerService,
        LibraryWatcher,
        AdminService,
        LockService,
        MediaTickets,
        // Every route passes the lock first; those marked PrivateBy, or on a controller that is, are held.
        { provide: APP_GUARD, useClass: LockGuard },
        // Then the admin lock, which holds back the routes marked AdminOnly.
        { provide: APP_GUARD, useClass: AdminGuard },
      ],
    }
  }
}
