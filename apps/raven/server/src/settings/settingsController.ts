import { Body, Controller, Get, Inject, Put } from '@nestjs/common'
import { type PlaybackSettingsState, isPlaybackSettingsChange } from '@raven/core'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseBody } from '@/parseBody'
import { SettingsRepository } from '@/settings/settingsRepository'

/** Settings that hold for every viewer: how video is played. */
@Controller('api/settings')
export class SettingsController {
  constructor(
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
  ) {}

  private async state(): Promise<PlaybackSettingsState> {
    const [encoder, tonemapAvailable] = await Promise.all([
      this.ffmpeg.videoEncoder(),
      this.ffmpeg.canTonemap(),
    ])
    return {
      settings: this.settings.playback(),
      effective: { encoder: encoder.kind, tonemapAvailable },
    }
  }

  @Get('playback')
  playback(): Promise<PlaybackSettingsState> {
    return this.state()
  }

  /** Changes the fields sent; a new choice of hardware takes effect on the next transcode. */
  @Put('playback')
  async setPlayback(@Body() body: unknown): Promise<PlaybackSettingsState> {
    const change = parseBody({
      guard: isPlaybackSettingsChange,
      body,
      message: 'Each setting must be one of the values it takes.',
    })
    const before = this.settings.playback()
    const after = this.settings.setPlayback(change)
    if (after.hwAccel !== before.hwAccel) this.ffmpeg.resetEncoder()
    return this.state()
  }
}
