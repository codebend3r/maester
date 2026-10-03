import { Controller, Get, Inject } from '@nestjs/common'
import { FfmpegService } from '@/ffmpeg/ffmpegService.js'
import { ThumbnailService } from '@/thumbnails/thumbnailService.js'

export type Health = {
  status: 'ok'
  /** null when ffmpeg is missing, in which case nothing but direct play works. */
  ffmpeg: string | null
  /** Whether HDR thumbnails and transcodes get tone mapped to SDR. */
  tonemap: boolean
  thumbnailsPending: number
}

@Controller('api/health')
export class HealthController {
  constructor(
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(ThumbnailService) private readonly thumbnails: ThumbnailService,
  ) {}

  @Get()
  async get(): Promise<Health> {
    const [ffmpeg, tonemap] = await Promise.all([this.ffmpeg.version(), this.ffmpeg.canTonemap()])
    return { status: 'ok', ffmpeg, tonemap, thumbnailsPending: this.thumbnails.pending() }
  }
}
