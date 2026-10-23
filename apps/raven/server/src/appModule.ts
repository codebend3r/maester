import { type DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import type { AuthConfig } from '@raven/core'
import type { JWTVerifyGetKey } from 'jose'
import { ACCESS_RECHECK_MS, AccessRechecks, DEFAULT_ACCESS_RECHECK_MS } from '@/auth/accessRechecks'
import { AccountGuard } from '@/auth/accountGuard'
import { AccountTickets } from '@/auth/accountTickets'
import { AuthBackend } from '@/auth/authBackend'
import { AuthController } from '@/auth/authController'
import { AUTH_STATE, resolveAuthState } from '@/auth/effectiveAuth'
import { AUTH_VERIFY, AuthSessions } from '@/auth/authSessions'
import { Management } from '@/auth/management'
import { MEMBERSHIP_TTL, MEMBERSHIP_TTL_MS, MembershipLookups } from '@/auth/membershipLookups'
import { AUTH_FETCH, createTokenVerifier, type AuthFetch } from '@/auth/tokenVerifier'
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
import { ItemPictureFiles } from '@/items/itemPictureFiles'
import { PicturesController } from '@/items/picturesController'
import { ReviewsController } from '@/items/reviewsController'
import { LibrariesController } from '@/libraries/librariesController'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { RatingsRefresh } from '@/libraries/ratingsRefresh'
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
import { TitleFavourites } from '@/media/titleFavourites'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { ViewingAdoption } from '@/media/viewingAdoption'
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
import { PictureVersions } from '@/metadata/pictureVersions'
import { ItemPictures } from '@/metadata/itemPictures'
import { ItemRefresher } from '@/metadata/itemRefresher'
import { MatchFactsCache } from '@/metadata/matchFactsCache'
import { MatchFiles } from '@/metadata/matchFiles'
import { MdblistClient } from '@/metadata/mdblistClient'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { MetadataService } from '@/metadata/metadataService'
import { OmdbClient } from '@/metadata/omdbClient'
import { Scores } from '@/metadata/scores'
import { ScoreSweep } from '@/metadata/scoreSweep'
import { METADATA_FETCH, type MetadataFetch, TmdbClient } from '@/metadata/tmdbClient'
import { Filmographies } from '@/people/filmographies'
import { PeopleRepository } from '@/people/peopleRepository'
import { PlaybackController } from '@/playback/playbackController'
import { BugReportsController } from '@/reports/bugReportsController'
import { BugReportsRepository } from '@/reports/bugReportsRepository'
import { SubtitlesService } from '@/playback/subtitlesService'
import { StreamsController } from '@/streams/streamsController'
import { StreamSessions } from '@/streams/streamSessions'
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
  PicturesController,
  ReviewsController,
  SettingsController,
  EventsController,
  LockController,
  AdminController,
  StreamsController,
  BugReportsController,
  AuthController,
] as const

/** Folders stay still for 2 s before a refresh. */
const DEFAULT_WATCH: WatchOptions = {
  watchFolder,
  quietMs: 2_000,
}

/**
 * Takes its config as an argument so a test can point it at a temporary data
 * dir, the fetches metadata and the AI lookup use so a test can answer for TMDB and Claude, and the
 * watcher's and the access rechecks' timing so a test need not wait.
 */
@Module({})
export class AppModule {
  static register({
    config,
    metadataFetch = ({ url, init }) => fetch(url, init),
    aiFetch = (input, init) => fetch(input, init),
    watch = {},
    authFetch = ({ url, init }) => fetch(url, init),
    authKeys,
    accessRecheckMs = DEFAULT_ACCESS_RECHECK_MS,
    membershipTtlMs = MEMBERSHIP_TTL_MS,
  }: {
    config: ServerConfig
    metadataFetch?: MetadataFetch
    aiFetch?: AiFetch
    watch?: Partial<WatchOptions>
    authFetch?: AuthFetch
    authKeys?: JWTVerifyGetKey
    accessRecheckMs?: number
    membershipTtlMs?: number
  }): DynamicModule {
    assertRoutesMarked(CONTROLLERS)
    return {
      module: AppModule,
      controllers: [...CONTROLLERS],
      providers: [
        { provide: SERVER_CONFIG, useValue: config },
        { provide: AUTH_FETCH, useValue: authFetch },
        {
          provide: AUTH_STATE,
          inject: [SERVER_CONFIG, SettingsRepository],
          useFactory: (serverConfig: ServerConfig, settings: SettingsRepository) =>
            resolveAuthState({ config: serverConfig, settings }),
        },
        {
          provide: AUTH_VERIFY,
          inject: [AUTH_STATE],
          useFactory: (auth: AuthConfig) =>
            createTokenVerifier({ config: auth, keys: authKeys, authFetch }),
        },
        AuthBackend,
        { provide: MEMBERSHIP_TTL, useValue: membershipTtlMs },
        MembershipLookups,
        AuthSessions,
        Management,
        AccountTickets,
        { provide: ACCESS_RECHECK_MS, useValue: accessRecheckMs },
        AccessRechecks,
        { provide: METADATA_FETCH, useValue: metadataFetch },
        { provide: AI_FETCH, useValue: aiFetch },
        { provide: WATCH_OPTIONS, useValue: { ...DEFAULT_WATCH, ...watch } },
        DatabaseService,
        ServerEvents,
        LibrariesRepository,
        SettingsRepository,
        PictureVersions,
        ItemImagesRepository,
        ItemPictureFiles,
        MetadataRepository,
        PeopleRepository,
        ItemOverrides,
        SagaBackdrops,
        MediaRepository,
        MovieSplits,
        ViewingAdoption,
        ViewingAccounts,
        ViewingRepository,
        TitleFavourites,
        WatchedCards,
        WatchedRepository,
        MediaIndex,
        MatchFiles,
        AiDecisions,
        TmdbClient,
        MatchFactsCache,
        Filmographies,
        OmdbClient,
        MdblistClient,
        AiClient,
        AiMatcher,
        ImageCache,
        Scores,
        ScoreSweep,
        ItemPictures,
        MetadataService,
        ItemRefresher,
        FfmpegService,
        ThumbnailService,
        TracksService,
        SubtitlesService,
        MediaArtifacts,
        ScannerService,
        RatingsRefresh,
        LibraryWatcher,
        AdminService,
        LockService,
        MediaTickets,
        StreamSessions,
        BugReportsRepository,
        // First the account gate: with accounts ready, every route but the open ones needs an account.
        { provide: APP_GUARD, useClass: AccountGuard },
        // Every route passes the lock first; those marked PrivateBy, or on a controller that is, are held.
        { provide: APP_GUARD, useClass: LockGuard },
        // Then the admin lock, which holds back the routes marked AdminOnly.
        { provide: APP_GUARD, useClass: AdminGuard },
      ],
    }
  }
}
