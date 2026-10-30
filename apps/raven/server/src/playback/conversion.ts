import { stat } from 'node:fs/promises'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import {
  type AudioTrack,
  type MediaTracks,
  PLAYBACK_MODES,
  SUBTITLE_SOURCES,
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

type RefuseWhatSettingsTurnOffProps = {
  playback: PlaybackSettings
  mode: StreamMode
}

/** Refuses a conversion the playback settings turn off. */
export const refuseWhatSettingsTurnOff = ({
  playback,
  mode,
}: RefuseWhatSettingsTurnOffProps): void => {
  if (playback.transcoding === TRANSCODINGS.off) {
    throw new ForbiddenException('Server conversion is off in Settings; only direct play is on.')
  }
  if (playback.transcoding === TRANSCODINGS.remuxOnly && mode === PLAYBACK_MODES.transcode) {
    throw new ForbiddenException('Transcoding is off in Settings; only remuxing is on.')
  }
}

type StreamSize = (typeof STREAM_QUALITIES)[StreamQuality]

type StreamSizeOfProps = {
  quality: string | undefined
  mode: StreamMode
}

/** The size a viewer asked a transcode for, or null for the server's settings. */
export const streamSizeOf = ({
  quality,
  mode,
}: StreamSizeOfProps): { key: StreamQuality; size: StreamSize } | null => {
  if (quality == null) return null
  if (!isStreamQuality(quality)) {
    throw new BadRequestException('quality must be one of the listed sizes')
  }
  if (mode !== PLAYBACK_MODES.transcode) {
    throw new BadRequestException('quality applies to a transcode only')
  }
  return { key: quality, size: STREAM_QUALITIES[quality] }
}

type CapHeightProps = {
  size: StreamSize | null
  maxHeight: number
}

/** The server's setting is the ceiling a viewer's pick can not lift. */
export const capHeight = ({ size, maxHeight }: CapHeightProps): number =>
  Math.min(size?.height ?? maxHeight, maxHeight)

type AudioTrackOfProps = {
  tracks: MediaTracks
  audio: string | undefined
}

/** The audio track asked for by its `0:a:N` index, or the file's default when none is. */
export const audioTrackOf = ({ tracks, audio }: AudioTrackOfProps): AudioTrack | null => {
  const chosen = audio == null ? tracks.defaultAudio : wholeNumber(audio)
  const track = tracks.audio.find((candidate) => candidate.index === chosen) ?? null
  if (audio != null && !track) throw new BadRequestException(`No audio track ${audio}`)
  return track
}

type BurnTrackOfProps = {
  tracks: MediaTracks
  burn: string | undefined
  mode: StreamMode
}

/**
 * The `0:s:N` picture subtitle a transcode burns into the picture, or null when none is asked
 * for. Only a transcode re-encodes the picture, and only a picture track needs burning: a text
 * track is a rendition of its own. Anything else is a 400.
 */
export const burnTrackOf = ({ tracks, burn, mode }: BurnTrackOfProps): number | null => {
  if (burn == null) return null
  if (mode !== PLAYBACK_MODES.transcode) {
    throw new BadRequestException('burn applies to a transcode only')
  }
  const embedded = tracks.subtitles.filter((track) => track.source === SUBTITLE_SOURCES.embedded)
  const place = embedded.findIndex((track) => track.id === burn)
  const track = embedded[place]
  if (track === undefined) throw new BadRequestException(`No subtitle track ${burn}`)
  if (track.supported) {
    throw new BadRequestException('Only a picture subtitle is burned in; a text one is a rendition')
  }
  return place
}

/** The file's size in bytes, or a 404 once it is no longer on disk. */
export const sizeOnDisk = async (file: MediaFile): Promise<number> => {
  const info = await stat(file.path).catch(() => null)
  if (info === null || !info.isFile()) throw new NotFoundException('The file is no longer on disk')
  return info.size
}

type VideoEncodingOfProps = {
  ffmpeg: Pick<FfmpegService, 'canTonemap' | 'videoEncoder'>
  file: MediaFile
  mode: StreamMode
  playback: PlaybackSettings
}

/** How the video is encoded: a remux encodes nothing, a transcode tone maps HDR when it can. */
export const videoEncodingOf = async ({
  ffmpeg,
  file,
  mode,
  playback,
}: VideoEncodingOfProps): Promise<{ tonemap: boolean; encoder: VideoEncoder }> => {
  if (mode !== PLAYBACK_MODES.transcode) return { tonemap: false, encoder: SOFTWARE }
  const tonemap = file.hdr && playback.tonemap && (await ffmpeg.canTonemap())
  return { tonemap, encoder: await ffmpeg.videoEncoder() }
}
