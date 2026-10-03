import { type DynamicModule, Module } from '@nestjs/common'
import { SERVER_CONFIG, type ServerConfig } from '@/config.js'
import { DatabaseService } from '@/db/database.js'
import { FfmpegService } from '@/ffmpeg/ffmpegService.js'
import { BrowseController } from '@/fs/browseController.js'
import { HealthController } from '@/health/healthController.js'
import { LibrariesController } from '@/libraries/librariesController.js'
import { LibrariesRepository } from '@/libraries/librariesRepository.js'
import { FavouritesController } from '@/media/favouritesController.js'
import { MediaController } from '@/media/mediaController.js'
import { MediaRepository } from '@/media/mediaRepository.js'
import { ScannerService } from '@/scanner/scannerService.js'
import { ThumbnailService } from '@/thumbnails/thumbnailService.js'

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
