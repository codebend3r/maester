import { MP4_BOXES } from '@/hls/segmentFiles'

/** The boxes inside a track and a fragment that hold the clock. */
const TRACK_BOXES = {
  track: 'trak',
  trackHeader: 'tkhd',
  media: 'mdia',
  mediaHeader: 'mdhd',
  trackFragment: 'traf',
  trackFragmentHeader: 'tfhd',
  decodeTime: 'tfdt',
} as const

/** The full box version 1 widens the times before the field read. */
const WIDE_VERSION = 1

type Box = { type: string; start: number; end: number; body: number }

type BoxesInProps = { bytes: Buffer; start: number; end: number }

const boxesIn = ({ bytes, start, end }: BoxesInProps): Box[] => {
  if (start >= end) return []
  const small = bytes.readUInt32BE(start)
  const isLarge = small === 1
  const size = isLarge ? Number(bytes.readBigUInt64BE(start + 8)) : small
  const box = {
    type: bytes.toString('ascii', start + 4, start + 8),
    start,
    end: start + size,
    body: start + (isLarge ? 16 : 8),
  }
  return [box, ...boxesIn({ bytes, start: box.end, end })]
}

const topBoxes = (bytes: Buffer): Box[] => boxesIn({ bytes, start: 0, end: bytes.length })

type InsideProps = { bytes: Buffer; box: Box | undefined; type: string }

const inside = ({ bytes, box, type }: InsideProps) =>
  box
    ? boxesIn({ bytes, start: box.body, end: box.end }).filter((child) => child.type === type)
    : []

type FullBoxFieldProps = {
  bytes: Buffer
  box: Box | undefined
  narrow: number
  wide: number
}

/** Reads a full box's field `offset` bytes past its version and flags, wider in version 1. */
const fullBoxField = ({ bytes, box, narrow, wide }: FullBoxFieldProps): number => {
  if (!box) throw new Error('Missing box')
  return bytes.readUInt32BE(box.body + (bytes[box.body] === WIDE_VERSION ? wide : narrow))
}

type VideoTfdtProps = { init: Buffer; media: Buffer }

/** The video track's decode time at the segment's first fragment, in seconds. */
export const videoTfdt = ({ init, media }: VideoTfdtProps): number => {
  const moov = topBoxes(init).find((box) => box.type === MP4_BOXES.movie)
  const [trak] = inside({ bytes: init, box: moov, type: TRACK_BOXES.track })
  const [tkhd] = inside({ bytes: init, box: trak, type: TRACK_BOXES.trackHeader })
  const [mdia] = inside({ bytes: init, box: trak, type: TRACK_BOXES.media })
  const [mdhd] = inside({ bytes: init, box: mdia, type: TRACK_BOXES.mediaHeader })
  const trackId = fullBoxField({ bytes: init, box: tkhd, narrow: 12, wide: 20 })
  const timescale = fullBoxField({ bytes: init, box: mdhd, narrow: 12, wide: 20 })

  const moof = topBoxes(media).find((box) => box.type === MP4_BOXES.fragment)
  const traf = inside({ bytes: media, box: moof, type: TRACK_BOXES.trackFragment }).find(
    (candidate) => {
      const [tfhd] = inside({ bytes: media, box: candidate, type: TRACK_BOXES.trackFragmentHeader })
      return tfhd != null && media.readUInt32BE(tfhd.body + 4) === trackId
    },
  )
  const [tfdt] = inside({ bytes: media, box: traf, type: TRACK_BOXES.decodeTime })
  if (!tfdt) throw new Error('No tfdt for the video track')
  const decodeTime =
    media[tfdt.body] === WIDE_VERSION
      ? Number(media.readBigUInt64BE(tfdt.body + 4))
      : media.readUInt32BE(tfdt.body + 4)
  return decodeTime / timescale
}

export const mdatOf = (media: Buffer): Buffer =>
  Buffer.concat(
    topBoxes(media)
      .filter((box) => box.type === MP4_BOXES.mediaData)
      .map((box) => media.subarray(box.start, box.end)),
  )
