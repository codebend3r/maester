import { stat } from 'node:fs/promises'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import {
  type AudioTrack,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackSettings,
  STREAM_QUALITIES,
  type StreamMode,
  type StreamQuality,
  TRANSCODINGS,
  isStreamMode,
  isStreamQuality,
} from '@raven/core'
import { wholeNumber } from '@shared/server'
import { SOFTWARE, type VideoEncoder } from '@/ffmpeg/encoder'
import type { FfmpegService } from '@/ffmpeg/ffmpegService'
import type { MediaFile } from '@/media/mediaIndex'

/** The mode a converted stream, MSE or HLS, was asked for, or a 400. */
export const streamModeOf = (mode: string | undefined): StreamMode => {
  if (!isStreamMode(mode)) throw new BadRequestException('mode must be remux or transcode')
  return mode
}

/** Refuses a conversion the playback settings turn off. */
export const refuseWhatSettingsTurnOff = ({
  playback,
  mode,
}: {
  playback: PlaybackSettings
  mode: StreamMode
}): void => {
  if (playback.transcoding === TRANSCODINGS.off) {
    throw new ForbiddenException('Server conversion is off in Settings; only direct play is on.')
  }
  if (playback.transcoding === TRANSCODINGS.remuxOnly && mode === PLAYBACK_MODES.transcode) {
    throw new ForbiddenException('Transcoding is off in Settings; only remuxing is on.')
  }
}

type StreamSize = (typeof STREAM_QUALITIES)[StreamQuality]

/** The size a viewer asked a transcode for, or null for the server's settings. */
export const streamSizeOf = ({
  quality,
  mode,
}: {
  quality: string | undefined
  mode: StreamMode
}): { key: StreamQuality; size: StreamSize } | null => {
  if (quality == null) return null
  if (!isStreamQuality(quality)) {
    throw new BadRequestException('quality must be one of the listed sizes')
  }
  if (mode !== PLAYBACK_MODES.transcode) {
    throw new BadRequestException('quality applies to a transcode only')
  }
  return { key: quality, size: STREAM_QUALITIES[quality] }
}

/** The server's setting is the ceiling a viewer's pick can not lift. */
export const capHeight = ({
  size,
  maxHeight,
}: {
  size: StreamSize | null
  maxHeight: number
}): number => Math.min(size?.height ?? maxHeight, maxHeight)

/** The audio track asked for by its `0:a:N` index, or the file's default when none is. */
export const audioTrackOf = ({
  tracks,
  audio,
}: {
  tracks: MediaTracks
  audio: string | undefined
}): AudioTrack | null => {
  const chosen = audio == null ? tracks.defaultAudio : wholeNumber(audio)
  const track = tracks.audio.find((candidate) => candidate.index === chosen) ?? null
  if (audio != null && !track) throw new BadRequestException(`No audio track ${audio}`)
  return track
}

/** The file's size in bytes, or a 404 once it is no longer on disk. */
export const sizeOnDisk = async (file: MediaFile): Promise<number> => {
  const info = await stat(file.path).catch(() => null)
  if (info === null || !info.isFile()) throw new NotFoundException('The file is no longer on disk')
  return info.size
}

/** How the video is encoded: a remux encodes nothing, a transcode tone maps HDR when it can. */
export const videoEncodingOf = async ({
  ffmpeg,
  file,
  mode,
  playback,
}: {
  ffmpeg: Pick<FfmpegService, 'canTonemap' | 'videoEncoder'>
  file: MediaFile
  mode: StreamMode
  playback: PlaybackSettings
}): Promise<{ tonemap: boolean; encoder: VideoEncoder }> => {
  if (mode !== PLAYBACK_MODES.transcode) return { tonemap: false, encoder: SOFTWARE }
  const tonemap = file.hdr && playback.tonemap && (await ffmpeg.canTonemap())
  return { tonemap, encoder: await ffmpeg.videoEncoder() }
}
