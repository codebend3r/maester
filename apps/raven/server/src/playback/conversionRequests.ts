import { Inject, Injectable } from '@nestjs/common'
import {
  type AudioTrack,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackSettings,
  type StreamMode,
  VIDEO_CODECS,
} from '@raven/core'
import { type PicturePlan, VIDEO_PLAN_KINDS } from '@/ffmpeg/args'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { parseProbe } from '@/ffmpeg/probe'
import { parseStreams } from '@/ffmpeg/streams'
import { type MediaFile, MediaIndex } from '@/media/mediaIndex'
import {
  audioTrackOf,
  burnSubtitleOf,
  capHeight,
  refuseWhatSettingsTurnOff,
  type SizedStream,
  sizeOnDisk,
  streamModeOf,
  type VideoEncoding,
  videoEncodingOf,
} from '@/playback/conversion'
import { TracksService } from '@/playback/tracksService'
import { QUERY_PARAMS, queryText } from '@/queryValues'
import type { ClientRequest } from '@/remoteAccess/clientNetwork'
import { streamSizeFor } from '@/remoteAccess/remoteCap'
import { SettingsRepository } from '@/settings/settingsRepository'

/** What a converted stream's query asks for, each read once as text, or absent. */
type ConversionAsk = {
  mode: string | undefined
  audio: string | undefined
  quality: string | undefined
  burn: string | undefined
}

/** The same asks as the route took them off the query, not yet checked. */
type ConversionQuery = Record<keyof ConversionAsk, unknown>

/** Reads each of the query's asks as text given once, or a 400. */
const askOf = (query: ConversionQuery): ConversionAsk => ({
  mode: queryText({ value: query.mode, name: QUERY_PARAMS.mode }),
  audio: queryText({ value: query.audio, name: QUERY_PARAMS.audio }),
  quality: queryText({ value: query.quality, name: QUERY_PARAMS.quality }),
  burn: queryText({ value: query.burn, name: QUERY_PARAMS.burn }),
})

/** A converted stream asked for and checked: the file, its tracks, its size and how its picture is made. */
export type Conversion = {
  mode: StreamMode
  playback: PlaybackSettings
  /** The size the viewer asked for, under Remote Access's limit away from home; null for the settings'. */
  sized: SizedStream | null
  file: MediaFile
  /** The file's size on disk in bytes. */
  bytes: number
  tracks: MediaTracks
  audio: AudioTrack | null
  /** The frame a transcode is scaled down to, the settings' ceiling and the viewer's ask. */
  maxHeight: number
  /** A ceiling on a transcode's video bitrate, when the viewer asked for a size. */
  bitrate: number | null
  video: PicturePlan
  /** ffprobe's report of the file, read at most once whoever asks. */
  probe: () => Promise<unknown>
}

type ConversionRequestsOpenProps = {
  id: number
  query: ConversionQuery
  request: ClientRequest
}

type PictureOfProps = Pick<
  Conversion,
  'mode' | 'file' | 'maxHeight' | 'bitrate' | 'playback' | 'probe'
> & {
  burn: Awaited<ReturnType<typeof burnSubtitleOf>>
  encoding: VideoEncoding
}

/** Reads a file's probe on its first ask only. */
const probeOnce = (read: () => Promise<unknown>): (() => Promise<unknown>) => {
  const held: { probe: Promise<unknown> | null } = { probe: null }
  return () => {
    held.probe ??= read()
    return held.probe
  }
}

/**
 * How the picture is made. A copy of HEVC the scan found HDR (a Dolby Vision record counts as
 * HDR) keeps its Dolby Vision configuration, which only the probe has, so only it is probed.
 */
const pictureOf = async ({
  mode,
  file,
  maxHeight,
  bitrate,
  playback,
  probe,
  burn,
  encoding,
}: PictureOfProps): Promise<PicturePlan> => {
  if (mode === PLAYBACK_MODES.transcode) {
    return {
      kind: VIDEO_PLAN_KINDS.transcode,
      encoder: encoding.encoder,
      videoCodec: file.videoCodec,
      tonemap: encoding.tonemap,
      maxHeight,
      quality: playback.quality,
      bitrate,
      burn,
    }
  }
  const isDolbyVisionCandidate = file.videoCodec === VIDEO_CODECS.hevc && file.hdr
  const dolbyVision = isDolbyVisionCandidate
    ? (parseStreams(await probe()).video?.dolbyVision ?? null)
    : null
  return { kind: VIDEO_PLAN_KINDS.copy, videoCodec: file.videoCodec, dolbyVision }
}

/**
 * The checks and reads both converted routes, the browser's `/stream` and the HLS master, make
 * before they run ffmpeg: the mode the settings allow, the size asked for, the file still on disk,
 * the audio track, a picture subtitle to burn and how the picture is encoded.
 */
@Injectable()
export class ConversionRequests {
  constructor(
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(MediaIndex) private readonly index: MediaIndex,
    @Inject(TracksService) private readonly tracks: TracksService,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
  ) {}

  async open({ id, query, request }: ConversionRequestsOpenProps): Promise<Conversion> {
    const ask = askOf(query)
    const mode = streamModeOf(ask.mode)
    const playback = this.settings.playback()
    refuseWhatSettingsTurnOff({ playback, mode })
    const sized = streamSizeFor({
      quality: ask.quality,
      mode,
      request,
      remote: this.settings.remoteAccess(),
      playback,
    })
    const file = this.index.requireFile(id)
    const bytes = await sizeOnDisk(file)
    const probe = probeOnce(() => this.ffmpeg.probeJson(file.path))
    const [{ tracks }, encoding] = await Promise.all([
      this.tracks.tracksFor(file),
      videoEncodingOf({ ffmpeg: this.ffmpeg, file, mode, playback }),
    ])
    const audio = audioTrackOf({ tracks, audio: ask.audio })
    const burn = await burnSubtitleOf({
      tracks,
      burn: ask.burn,
      mode,
      probe: async () => parseProbe(await probe()),
    })
    const maxHeight = capHeight({ size: sized?.size ?? null, maxHeight: playback.maxHeight })
    const bitrate = sized?.size.bitrate ?? null
    const video = await pictureOf({
      mode,
      file,
      maxHeight,
      bitrate,
      playback,
      probe,
      burn,
      encoding,
    })
    return { mode, playback, sized, file, bytes, tracks, audio, maxHeight, bitrate, video, probe }
  }
}
