import { HEALTH_STATUSES } from '@raven/core'
import { Controller, Get, Inject } from '@nestjs/common'
import type { ServerHealth } from '@raven/core'
import { OpenToAnyone } from '@/auth/accountGuard'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { MetadataService } from '@/metadata/metadataService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

@Controller('api/health')
export class HealthController {
  constructor(
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  @OpenToAnyone()
  @Get()
  async get(): Promise<ServerHealth> {
    const [ffmpeg, tonemap, encoder] = await Promise.all([
      this.ffmpeg.version(),
      this.ffmpeg.canTonemap(),
      this.ffmpeg.videoEncoder(),
    ])
    return {
      status: HEALTH_STATUSES.ok,
      ffmpeg,
      tonemap,
      encoder: encoder.kind,
      thumbnailsPending: this.thumbnails.pending(),
      metadata: this.metadata.health(),
    }
  }
}
