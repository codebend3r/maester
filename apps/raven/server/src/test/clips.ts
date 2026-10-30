import { execFile } from 'node:child_process'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The test pattern's frames per second. */
const CLIP_FPS = 24

type EncodeClipProps = {
  path: string
  seconds?: number
  audio?: 'aac' | 'ac3'
  /** The frame size, `WIDTHxHEIGHT`. */
  size?: string
  /** Seconds between keyframes, exactly, with no scene cut adding one. */
  keyframeEvery?: number
  /** Where the file's own clock starts, in seconds, as a broadcast recording's does. */
  startAt?: number
  /** Frames per second, as ffmpeg writes a rate: `24000/1001` for NTSC film. */
  frameRate?: string
  /** How long after the sound the picture starts, as in many broadcast recordings. */
  videoDelay?: number
}

/**
 * Encodes a short test-pattern clip with a tone, so the suite exercises the
 * real ffprobe and ffmpeg rather than fixtures. `audio` picks the audio
 * codec: aac plays anywhere, ac3 is what browsers refuse.
 */
export const encodeClip = async ({
  path,
  seconds = 6,
  audio = 'aac',
  size = '320x240',
  keyframeEvery,
  startAt,
  frameRate = String(CLIP_FPS),
  videoDelay,
}: EncodeClipProps): Promise<void> => {
  const [top = CLIP_FPS, bottom = 1] = frameRate.split('/').map(Number)
  const gop = keyframeEvery == null ? null : String(Math.round((keyframeEvery * top) / bottom))
  await mkdir(dirname(path), { recursive: true })
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...(videoDelay == null ? [] : ['-itsoffset', String(videoDelay)]),
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${size}:rate=${frameRate}:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:v',
    'libx264',
    ...(gop == null ? [] : ['-g', gop, '-keyint_min', gop, '-sc_threshold', '0']),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    audio,
    '-shortest',
    ...(startAt == null ? [] : ['-output_ts_offset', String(startAt)]),
    path,
  ])
}

type AddChaptersProps = {
  path: string
  chapters: ReadonlyArray<{ start: number; end: number; title: string }>
}

/** Rewrites a clip in place with `chapters`, times in seconds, as a remux with named chapters carries them. */
export const addChapters = async ({ path, chapters }: AddChaptersProps): Promise<void> => {
  const metadata = `${path}.ffmetadata`
  const chaptered = `${path}.chaptered${extname(path)}`
  const lines = chapters.flatMap(({ start, end, title }) => [
    '[CHAPTER]',
    'TIMEBASE=1/1000',
    `START=${Math.round(start * 1000)}`,
    `END=${Math.round(end * 1000)}`,
    `title=${title}`,
  ])
  await writeFile(metadata, [';FFMETADATA1', ...lines, ''].join('\n'))
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    path,
    '-i',
    metadata,
    '-map_metadata',
    '1',
    '-map_chapters',
    '1',
    '-c',
    'copy',
    chaptered,
  ])
  await rename(chaptered, path)
  await rm(metadata)
}

/** A PGS segment's type, as a Blu-ray's subtitle stream names it. */
const PGS_SEGMENTS = {
  palette: 0x14,
  object: 0x15,
  presentation: 0x16,
  window: 0x17,
  end: 0x80,
} as const

/** The 90 kHz clock PGS stamps its segments with. */
const PGS_CLOCK = 90_000

type PgsSegmentProps = { pts: number; type: number; data: readonly number[] }

/** One segment: the "PG" magic, its time (and a decode time of 0), its type, size and data. */
const pgsSegment = ({ pts, type, data }: PgsSegmentProps): number[] => {
  const stamp = Math.round(pts * PGS_CLOCK)
  return [
    0x50,
    0x47,
    (stamp >>> 24) & 0xff,
    (stamp >>> 16) & 0xff,
    (stamp >>> 8) & 0xff,
    stamp & 0xff,
    0,
    0,
    0,
    0,
    type,
    (data.length >> 8) & 0xff,
    data.length & 0xff,
    ...data,
  ]
}

const be16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff]

type PgsCue = { start: number; end: number }

type WritePgsProps = { path: string; width: number; height: number; cues: readonly PgsCue[] }

/**
 * A Blu-ray PGS subtitle stream (`.sup`) holding, for each cue, a white box at the foot of the
 * frame from its start, and a clear screen at its end: a real picture track, which ffmpeg can not
 * make from text, for the tests that need one.
 */
const writePgs = async ({ path, width, height, cues }: WritePgsProps): Promise<void> => {
  const box = { width: 96, height: 16 }
  const at = { x: (width - box.width) >> 1, y: height - box.height - 8 }
  // Each line: one run of the palette's white across the box, then the end of the line.
  const line = [0x00, 0xc0 | (box.width >> 8), box.width & 0xff, 0x01, 0x00, 0x00]
  const rle = Array.from({ length: box.height }, () => line).flat()
  type ShowProps = { start: number; number: number }
  const show = ({ start, number }: ShowProps): number[] => [
    ...pgsSegment({
      pts: start,
      type: PGS_SEGMENTS.presentation,
      data: [
        ...be16(width),
        ...be16(height),
        0x10,
        ...be16(number),
        0x80,
        0,
        0,
        1,
        ...be16(0),
        0,
        0,
        ...be16(at.x),
        ...be16(at.y),
      ],
    }),
    ...pgsSegment({
      pts: start,
      type: PGS_SEGMENTS.window,
      data: [1, 0, ...be16(at.x), ...be16(at.y), ...be16(box.width), ...be16(box.height)],
    }),
    ...pgsSegment({ pts: start, type: PGS_SEGMENTS.palette, data: [0, 0, 1, 235, 128, 128, 255] }),
    ...pgsSegment({
      pts: start,
      type: PGS_SEGMENTS.object,
      data: [
        ...be16(0),
        0,
        0xc0,
        // The object's length in three bytes: its size and its run-length data.
        (rle.length + 4) >> 16,
        ((rle.length + 4) >> 8) & 0xff,
        (rle.length + 4) & 0xff,
        ...be16(box.width),
        ...be16(box.height),
        ...rle,
      ],
    }),
    ...pgsSegment({ pts: start, type: PGS_SEGMENTS.end, data: [] }),
  ]
  type ClearProps = { end: number; number: number }
  const clear = ({ end, number }: ClearProps): number[] => [
    ...pgsSegment({
      pts: end,
      type: PGS_SEGMENTS.presentation,
      data: [...be16(width), ...be16(height), 0x10, ...be16(number), 0x00, 0, 0, 0],
    }),
    ...pgsSegment({
      pts: end,
      type: PGS_SEGMENTS.window,
      data: [1, 0, ...be16(at.x), ...be16(at.y), ...be16(box.width), ...be16(box.height)],
    }),
    ...pgsSegment({ pts: end, type: PGS_SEGMENTS.end, data: [] }),
  ]
  const bytes = cues.flatMap(({ start, end }, index) => [
    ...show({ start, number: index * 2 }),
    ...clear({ end, number: index * 2 + 1 }),
  ])
  await writeFile(path, Uint8Array.from(bytes))
}

type EncodeRichClipProps = {
  path: string
  seconds?: number
  cues: string
  bFrames?: number
  /** Writes a picture track (Blu-ray PGS) in place of the text cues, which only a burn can show. */
  isPictureSubtitle?: boolean
}

/**
 * An MKV like a remux in miniature: a keyframe every two seconds, English
 * AC-3 audio (the default) and a Japanese AAC commentary, and an English
 * SRT track holding `cues`. `bFrames` sets how many B-frames x264 may put
 * between references, which reorders the video so its dts runs behind its pts.
 */
export const encodeRichClip = async ({
  path,
  seconds = 30,
  cues,
  bFrames,
  isPictureSubtitle = false,
}: EncodeRichClipProps): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  // A picture track is written as PGS, two boxes a few seconds apart; text keeps `cues`.
  const subtitles = isPictureSubtitle ? `${path}.source.sup` : `${path}.source.srt`
  await (isPictureSubtitle
    ? writePgs({
        path: subtitles,
        width: 320,
        height: 240,
        cues: [
          { start: 1, end: 3 },
          { start: 7, end: 9 },
        ],
      })
    : writeFile(subtitles, cues))
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=320x240:rate=24:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=880:duration=${seconds}`,
    '-i',
    subtitles,
    '-map',
    '0',
    '-map',
    '1',
    '-map',
    '2',
    '-map',
    '3',
    '-c:v',
    'libx264',
    '-g',
    '48',
    ...(bFrames == null ? [] : ['-bf', String(bFrames)]),
    '-pix_fmt',
    'yuv420p',
    '-c:a:0',
    'ac3',
    '-c:a:1',
    'aac',
    '-c:s',
    isPictureSubtitle ? 'copy' : 'srt',
    '-metadata:s:a:0',
    'language=eng',
    '-metadata:s:a:1',
    'language=jpn',
    '-metadata:s:a:1',
    'title=Commentary',
    '-metadata:s:s:0',
    'language=eng',
    '-disposition:a:0',
    'default',
    '-disposition:a:1',
    '0',
    path,
  ])
  await rm(subtitles)
}

type EncodeImageProps = {
  path: string
  size?: string
}

/** A still picture, such as a poster beside a movie, of one flat colour. */
export const encodeImage = async ({ path, size = '200x300' }: EncodeImageProps): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=teal:s=${size}`,
    '-frames:v',
    '1',
    path,
  ])
}

/** How wide and tall a JPEG says it is, read from its frame header. */
export const jpegSize = (jpeg: Buffer): { width: number; height: number } => {
  const read = (at: number): { width: number; height: number } => {
    if (at + 9 > jpeg.length || jpeg[at] !== 0xff) throw new Error('No JPEG frame header')
    const marker = jpeg[at + 1] ?? 0
    // SOF0 to SOF3 hold the frame's size; any other segment is passed over by its length.
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7) }
    }
    return read(at + 2 + jpeg.readUInt16BE(at + 2))
  }
  return read(2)
}

type EncodeTrackProps = {
  path: string
  seconds?: number
  /** The tags written into the file; each one left out stays unwritten. */
  tags?: Partial<
    Record<
      | 'title'
      | 'artist'
      | 'album'
      | 'album_artist'
      | 'track'
      | 'disc'
      | 'date'
      | 'genre'
      | 'compilation'
      | 'MUSICBRAINZ_ALBUMID'
      | 'MUSICBRAINZ_TRACKID'
      | 'MUSICBRAINZ_ARTISTID',
      string
    >
  >
  /** A JPEG to embed as the cover, as `encodeImage` writes one. */
  cover?: string | null
}

/**
 * Encodes a short tone as a tagged audio file, so the suite exercises the
 * real tag reader. The extension picks the codec: `.mp3`, `.flac`, `.m4a`
 * (AAC) or `.ogg` (Vorbis). A `cover` is embedded as an attached picture.
 */
export const encodeTrack = async ({
  path,
  seconds = 2,
  tags = {},
  cover = null,
}: EncodeTrackProps): Promise<void> => {
  const codecs: Record<string, string> = {
    mp3: 'libmp3lame',
    flac: 'flac',
    m4a: 'aac',
    ogg: 'libvorbis',
  }
  const codec = codecs[extname(path).slice(1)] ?? 'libmp3lame'
  await mkdir(dirname(path), { recursive: true })
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=44100:duration=${seconds}`,
    ...(cover == null
      ? []
      : [
          '-i',
          cover,
          '-map',
          '0:a',
          '-map',
          '1:v',
          '-c:v',
          'copy',
          '-disposition:v:0',
          'attached_pic',
        ]),
    '-c:a',
    codec,
    ...Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]),
    path,
  ])
}
