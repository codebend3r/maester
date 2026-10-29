import { Injectable } from '@nestjs/common'
import {
  type IAudioMetadata,
  type ICommonTagsResult,
  type IFormat,
  parseFile,
} from 'music-metadata'
import type { ProbeResult } from '@/ffmpeg/probe'
import type { FileTracks } from '@/ffmpeg/tracks'

/**
 * What the tags of an audio file say, with every source's key spelling
 * folded: ID3 frames, Vorbis comments and MP4 atoms all land here the same.
 * Each list is empty, and each value null, when the tags say nothing.
 */
export type AudioTags = {
  title: string | null
  /** The track's artists, in credit order: `artists` when the tags list them, else the one `artist`. */
  artists: string[]
  album: string | null
  /** The album's artists: `albumartists` when listed, else the one `albumartist`. */
  albumArtists: string[]
  trackNumber: number | null
  disc: number | null
  year: number | null
  originalYear: number | null
  genres: string[]
  isCompilation: boolean
  label: string | null
  isrc: string | null
  recordingMbid: string | null
  releaseMbid: string | null
  releaseGroupMbid: string | null
  /** Aligned with `artists` where the tags list as many ids as names. */
  artistMbids: string[]
  albumArtistMbids: string[]
  /** MusicBrainz release types: 'album', 'ep', 'single', 'compilation', 'live', 'soundtrack', ... */
  releaseTypes: string[]
  replayGain: {
    trackGain: number | null
    trackPeak: number | null
    albumGain: number | null
    albumPeak: number | null
  }
  /** Whether a picture is embedded, read once per album into the image cache. */
  hasCover: boolean
}

/** What the file's sound is, beyond what the index keeps of every file. */
export type AudioFormat = {
  sampleRate: number | null
  bitDepth: number | null
  isLossless: boolean
}

/** An audio file as the scanner reads it: the index's facts, its one track, its tags and its sound. */
export type AudioFile = {
  probe: ProbeResult
  tracks: FileTracks
  tags: AudioTags
  format: AudioFormat
}

/**
 * ffprobe's codec names for the ones `music-metadata` reports, so the
 * planner reads an audio file's codec as it reads a video's audio track.
 * A codec not listed keeps its name lowercased, with no spaces.
 */
const CODEC_NAMES: Record<string, string> = {
  'mpeg 1 layer 3': 'mp3',
  'mpeg 2 layer 3': 'mp3',
  'mpeg 2.5 layer 3': 'mp3',
  'mpeg 1 layer 2': 'mp2',
  'mpeg 2 layer 2': 'mp2',
  aac: 'aac',
  'mpeg-4/aac': 'aac',
  alac: 'alac',
  flac: 'flac',
  opus: 'opus',
  vorbis: 'vorbis',
  wavpack: 'wavpack',
  "monkey's audio": 'ape',
  pcm: 'pcm_s16le',
  dsd: 'dsd_lsbf',
}

/** Codecs that keep every sample, as `music-metadata` names them, for a file it does not flag lossless itself. */
const LOSSLESS_CODECS: ReadonlySet<string> = new Set([
  'flac',
  'alac',
  'wavpack',
  'ape',
  'pcm_s16le',
  'dsd_lsbf',
])

const text = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

const texts = (values: readonly string[] | undefined): string[] =>
  (values ?? []).flatMap((value) => {
    const trimmed = text(value)
    return trimmed === null ? [] : [trimmed]
  })

const whole = (value: number | null | undefined): number | null =>
  value != null && Number.isInteger(value) && value > 0 ? value : null

const positive = (value: number | undefined): number | null =>
  value != null && Number.isFinite(value) && value > 0 ? value : null

/** The year a tag's date opens with: `2003-04-01`, `2003`, or nothing. */
const yearOf = (date: string | undefined): number | null => {
  const match = /^(\d{4})/.exec(date?.trim() ?? '')
  return match?.[1] === undefined ? null : Number(match[1])
}

/** The codec as ffprobe names it, from `music-metadata`'s name. */
export const codecNameOf = (codec: string | undefined): string | null => {
  const named = text(codec)?.toLowerCase() ?? null
  if (named === null) return null
  return CODEC_NAMES[named] ?? named.replace(/\s+/g, '')
}

type CreditedProps = {
  names: readonly string[]
  one: string | undefined
}

/** The names the tags list, else the one name they give. */
const credited = ({ names, one }: CreditedProps): string[] => {
  const listed = texts(names)
  if (listed.length > 0) return listed
  const single = text(one)
  return single === null ? [] : [single]
}

/** The tags `music-metadata` folded from the file's own, as `AudioTags`. */
export const audioTagsOf = (common: ICommonTagsResult): AudioTags => ({
  title: text(common.title),
  artists: credited({ names: common.artists ?? [], one: common.artist }),
  album: text(common.album),
  albumArtists: credited({ names: common.albumartists ?? [], one: common.albumartist }),
  trackNumber: whole(common.track.no),
  disc: whole(common.disk.no),
  year: whole(common.year) ?? yearOf(common.date) ?? yearOf(common.releasedate),
  originalYear: whole(common.originalyear) ?? yearOf(common.originaldate),
  genres: texts(common.genre),
  isCompilation: common.compilation === true,
  label: text(common.label?.[0]),
  isrc: text(common.isrc?.[0]),
  recordingMbid: text(common.musicbrainz_recordingid),
  releaseMbid: text(common.musicbrainz_albumid),
  releaseGroupMbid: text(common.musicbrainz_releasegroupid),
  artistMbids: texts(common.musicbrainz_artistid),
  albumArtistMbids: texts(common.musicbrainz_albumartistid),
  releaseTypes: texts(common.releasetype).map((type) => type.toLowerCase()),
  replayGain: {
    trackGain: common.replaygain_track_gain?.dB ?? null,
    trackPeak: common.replaygain_track_peak?.ratio ?? null,
    albumGain: common.replaygain_album_gain?.dB ?? null,
    albumPeak: common.replaygain_album_peak?.ratio ?? null,
  },
  hasCover: (common.picture?.length ?? 0) > 0,
})

/** The index's facts for an audio file: no picture, one sound. */
export const audioProbeOf = (format: IFormat): ProbeResult => {
  const bitrate = positive(format.bitrate)
  return {
    duration: positive(format.duration),
    width: null,
    height: null,
    videoCodec: null,
    videoBitDepth: null,
    hdr: false,
    audioCodec: codecNameOf(format.codec),
    audioChannels: whole(format.numberOfChannels),
    bitrate: bitrate === null ? null : Math.round(bitrate),
  }
}

/** An audio file's one track, as the player's track list expects a file's tracks. */
export const audioTracksOf = (format: IFormat): FileTracks => ({
  audio: [
    {
      index: 0,
      codec: codecNameOf(format.codec),
      channels: whole(format.numberOfChannels),
      language: null,
      title: null,
      default: true,
    },
  ],
  subtitles: [],
  defaultAudio: 0,
  frameRate: null,
})

export const audioFormatOf = (format: IFormat): AudioFormat => {
  const codec = codecNameOf(format.codec)
  return {
    sampleRate: whole(format.sampleRate),
    bitDepth: whole(format.bitsPerSample),
    isLossless: format.lossless === true || (codec !== null && LOSSLESS_CODECS.has(codec)),
  }
}

/** Everything the scanner keeps of an audio file, from one `music-metadata` read. */
const audioFileOf = (metadata: IAudioMetadata): AudioFile => ({
  probe: audioProbeOf(metadata.format),
  tracks: audioTracksOf(metadata.format),
  tags: audioTagsOf(metadata.common),
  format: audioFormatOf(metadata.format),
})

/**
 * Reads audio files with `music-metadata` rather than ffprobe: about twice
 * as fast one file at a time, with no process per file, and it reads the
 * tags ffprobe throws away. Video keeps ffprobe.
 */
@Injectable()
export class AudioReader {
  async read(path: string): Promise<AudioFile> {
    const metadata = await parseFile(path, { skipPostHeaders: true })
    if (metadata.format.hasAudio === false) throw new Error('No audio stream')
    return audioFileOf(metadata)
  }
}
