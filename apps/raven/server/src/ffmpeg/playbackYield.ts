import type { FfmpegService } from '@/ffmpeg/ffmpegService'

/** How long background analysis waits, each time, while ffmpeg converts a file for someone watching. */
export const YIELD_MS = 30_000

type GivePlaybackWayProps = {
  ffmpeg: Pick<FfmpegService, 'isConverting'>
  /** Whether the server is stopping, which ends the wait at once. */
  isStopping: () => boolean
}

/** Waits while ffmpeg converts a file for someone watching, so background analysis never starves a viewer. */
export const givePlaybackWay = async ({
  ffmpeg,
  isStopping,
}: GivePlaybackWayProps): Promise<void> => {
  if (isStopping() || !ffmpeg.isConverting()) return
  await new Promise((resolve) => setTimeout(resolve, YIELD_MS).unref())
  await givePlaybackWay({ ffmpeg, isStopping })
}
