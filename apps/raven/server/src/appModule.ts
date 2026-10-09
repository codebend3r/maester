import { type DynamicModule, Module } from '@nestjs/common'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { BrowseController } from '@/fs/browseController'
import { HealthController } from '@/health/healthController'
import { LibrariesController } from '@/libraries/librariesController'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { FavouritesController } from '@/media/favouritesController'
import { MediaController } from '@/media/mediaController'
import { MediaRepository } from '@/media/mediaRepository'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

/** Takes its config as an argument so a test can point it at a temporary data dir. */
@Module({})
export class AppModule {
  static register(config: ServerConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        LibrariesController,
        MediaController,
        FavouritesController,
        BrowseController,
        HealthController,
      ],
      providers: [
        { provide: SERVER_CONFIG, useValue: config },
        DatabaseService,
        LibrariesRepository,
        MediaRepository,
        FfmpegService,
        ThumbnailService,
        ScannerService,
      ],
    }
  }
}
