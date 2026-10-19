/** The top-level MP4 boxes of a segment file: `ftyp moov`, then `moof mdat` pairs. */
export const MP4_BOXES = {
  fileType: 'ftyp',
  movie: 'moov',
  fragment: 'moof',
  mediaData: 'mdat',
} as const

const SEGMENT_FILE = { prefix: 'seg_', suffix: '.mp4' } as const

/** The name ffmpeg's segment muxer writes each file under, `%d` standing for its number. */
export const SEGMENT_FILE_PATTERN = `${SEGMENT_FILE.prefix}%d${SEGMENT_FILE.suffix}`

export const segmentFileName = (n: number): string =>
  `${SEGMENT_FILE.prefix}${n}${SEGMENT_FILE.suffix}`

/** The segment number a file name carries, or null for any other name. */
export const segmentNumberOf = (name: string): number | null => {
  if (!name.startsWith(SEGMENT_FILE.prefix) || !name.endsWith(SEGMENT_FILE.suffix)) return null
  const digits = name.slice(SEGMENT_FILE.prefix.length, -SEGMENT_FILE.suffix.length)
  return /^\d+$/.test(digits) ? Number(digits) : null
}

const HEADER_BYTES = 8
const LARGE_HEADER_BYTES = 16
/** A size of 1 says the real size follows the type as 64 bits; 0 says the box runs to the end. */
const SIZES = { large: 1, toEnd: 0 } as const

type Box = { type: string; end: number }

type Reading = { bytes: Uint8Array; view: DataView; offset: number }

const sizeAt = ({ bytes, view, offset }: Reading): number => {
  const small = view.getUint32(offset)
  if (small === SIZES.toEnd) return bytes.length - offset
  if (small !== SIZES.large) return small
  if (offset + LARGE_HEADER_BYTES > bytes.length) return Infinity
  return Number(view.getBigUint64(offset + HEADER_BYTES))
}

const boxAt = ({ bytes, view, offset }: Reading): Box => {
  if (offset + HEADER_BYTES > bytes.length) {
    throw new Error('An MP4 box header runs past the end of the file')
  }
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + HEADER_BYTES))
  const size = sizeAt({ bytes, view, offset })
  if (size < HEADER_BYTES || offset + size > bytes.length) {
    throw new Error(`The MP4 ${type} box runs past the end of the file`)
  }
  return { type, end: offset + size }
}

const boxesFrom = ({ bytes, view, offset }: Reading): Box[] => {
  if (offset >= bytes.length) return []
  const box = boxAt({ bytes, view, offset })
  return [box, ...boxesFrom({ bytes, view, offset: box.end })]
}

/**
 * Splits one file of a segment run into the init every segment shares
 * (`ftyp moov`) and the segment itself (everything after the `moov`).
 * Every top-level box must end inside the file, so a file ffmpeg is still
 * writing is refused rather than served cut short.
 */
export const splitSegmentFile = (bytes: Uint8Array): { init: Uint8Array; media: Uint8Array } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const movie = boxesFrom({ bytes, view, offset: 0 }).find((box) => box.type === MP4_BOXES.movie)
  if (!movie) throw new Error('The segment file has no moov box')
  return { init: bytes.subarray(0, movie.end), media: bytes.subarray(movie.end) }
}
