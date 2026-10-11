import { Controller, Get, Inject } from '@nestjs/common'
import type { MetadataHealth } from '@raven/core'
import type { VideoEncoder } from '@/ffmpeg/encoder'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { MetadataService } from '@/metadata/metadataService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'

export type Health = {
  status: 'ok'
  /** null when ffmpeg is missing, in which case nothing but direct play works. */
  ffmpeg: string | null
  /** Whether HDR thumbnails and transcodes get tone mapped to SDR. */
  tonemap: boolean
  /** What transcodes encode with: the CPU, or a GPU through VAAPI or VideoToolbox. */
  encoder: VideoEncoder['kind']
  thumbnailsPending: number
  /** Whether TMDB is configured and answering, and how many files wait to be matched. */
  metadata: MetadataHealth
}

@Controller('api/health')
export class HealthController {
  constructor(
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  @Get()
  async get(): Promise<Health> {
    const [ffmpeg, tonemap, encoder] = await Promise.all([
      this.ffmpeg.version(),
      this.ffmpeg.canTonemap(),
      this.ffmpeg.videoEncoder(),
    ])
    return {
      status: 'ok',
      ffmpeg,
      tonemap,
      encoder: encoder.kind,
      thumbnailsPending: this.thumbnails.pending(),
      metadata: this.metadata.health(),
    }
  }
}
