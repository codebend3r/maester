import { crc32, deflateSync } from 'node:zlib'
import type { PgsCrop, PgsObject, PgsPalette, PgsPicture } from '@/playback/pgs'

/** Where a run-length read stands: at a pixel, after an escape, or part way through a run. */
const RLE_STEPS = {
  pixel: 'pixel',
  escape: 'escape',
  length: 'length',
  colour: 'colour',
} as const

type RleStep =
  | { kind: typeof RLE_STEPS.pixel }
  | { kind: typeof RLE_STEPS.escape }
  | { kind: typeof RLE_STEPS.length; high: number; hasColour: boolean }
  | { kind: typeof RLE_STEPS.colour; length: number }

type RleRead = { row: number; column: number; step: RleStep }

const AT_PIXEL: RleStep = { kind: RLE_STEPS.pixel }

/** An escape's second byte: whether the run's length takes a second byte, and whether a colour follows. */
const LONG_RUN = 0x40
const COLOURED_RUN = 0x80
const RUN_LENGTH = 0x3f

/** The rows of a picture as PNG holds them: each led by one byte naming its filter, none. */
type Rows = { bytes: Buffer; width: number; height: number }

type PaintProps = { rows: Rows; read: RleRead; length: number; colour: number }

/** Paints a run onto its row, as far as the row goes, and moves along it. */
const paint = ({ rows, read, length, colour }: PaintProps): RleRead => {
  const { row, column } = read
  const count = row < rows.height ? Math.max(0, Math.min(length, rows.width - column)) : 0
  const from = row * (rows.width + 1) + 1 + column
  rows.bytes.fill(colour, from, from + count)
  return { row, column: column + length, step: AT_PIXEL }
}

type ReadByteProps = { rows: Rows; read: RleRead; byte: number }

/**
 * One byte of a PGS object's run-length coding. A byte that is not 0 is one pixel of that
 * colour. A 0 escapes: a second 0 ends the row, and any other byte opens a run, its top two bits
 * saying whether the length takes one more byte and whether a colour follows (colour 0 if not).
 */
const readByte = ({ rows, read, byte }: ReadByteProps): RleRead => {
  const { step } = read
  switch (step.kind) {
    case RLE_STEPS.pixel:
      return byte === 0
        ? { ...read, step: { kind: RLE_STEPS.escape } }
        : paint({ rows, read, length: 1, colour: byte })
    case RLE_STEPS.escape: {
      if (byte === 0) return { row: read.row + 1, column: 0, step: AT_PIXEL }
      const length = byte & RUN_LENGTH
      const hasColour = (byte & COLOURED_RUN) !== 0
      if ((byte & LONG_RUN) !== 0) {
        return { ...read, step: { kind: RLE_STEPS.length, high: length, hasColour } }
      }
      return hasColour
        ? { ...read, step: { kind: RLE_STEPS.colour, length } }
        : paint({ rows, read, length, colour: 0 })
    }
    case RLE_STEPS.length: {
      const length = step.high * 256 + byte
      return step.hasColour
        ? { ...read, step: { kind: RLE_STEPS.colour, length } }
        : paint({ rows, read, length, colour: 0 })
    }
    case RLE_STEPS.colour:
      return paint({ rows, read, length: step.length, colour: byte })
    default: {
      const unknown: never = step
      return unknown
    }
  }
}

/** An object's pixels, each a palette index, as PNG's unfiltered rows. */
const rowsOf = ({ width, height, rle }: PgsObject): Rows => {
  const rows = { bytes: Buffer.alloc((width + 1) * height), width, height }
  rle.reduce<RleRead>((read, byte) => readByte({ rows, read, byte }), {
    row: 0,
    column: 0,
    step: AT_PIXEL,
  })
  return rows
}

type CroppedProps = { rows: Rows; crop: PgsCrop }

/** The part of the rows a composition shows, kept inside the object. */
const cropped = ({ rows, crop }: CroppedProps): Rows => {
  const x = Math.min(crop.x, rows.width)
  const y = Math.min(crop.y, rows.height)
  const width = Math.min(crop.width, rows.width - x)
  const height = Math.min(crop.height, rows.height - y)
  const bytes = Buffer.concat(
    Array.from({ length: height }, (_, row) => {
      const from = (y + row) * (rows.width + 1) + 1 + x
      return [Buffer.alloc(1), rows.bytes.subarray(from, from + width)]
    }).flat(),
  )
  return { bytes, width, height }
}

/** The eight bytes every PNG opens with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The PNG chunks a palette picture is made of. */
const CHUNKS = {
  header: 'IHDR',
  palette: 'PLTE',
  transparency: 'tRNS',
  data: 'IDAT',
  end: 'IEND',
} as const

type ChunkProps = { type: (typeof CHUNKS)[keyof typeof CHUNKS]; data: Buffer }

/** One chunk: its data's length, its type, the data, and a checksum over the type and the data. */
const chunk = ({ type, data }: ChunkProps): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

/** A palette picture's header after its size: 8 bits a pixel, palette colour, and PNG's only compression, filter and interlace settings. */
const INDEXED_8_BIT = [8, 3, 0, 0, 0] as const

/** Every index a pixel can name. */
const PALETTE_SIZE = 256

const CLEAR = { red: 0, green: 0, blue: 0, alpha: 0 } as const

type IndexedPngProps = { rows: Rows; palette: PgsPalette }

/** A PNG of palette pixels: the indexes as they are, with each one's colour and how opaque it is. */
const indexedPng = ({ rows, palette }: IndexedPngProps): Buffer => {
  const size = Buffer.alloc(8)
  size.writeUInt32BE(rows.width, 0)
  size.writeUInt32BE(rows.height, 4)
  const colours = Array.from({ length: PALETTE_SIZE }, (_, index) => palette.get(index) ?? CLEAR)
  return Buffer.concat([
    SIGNATURE,
    chunk({ type: CHUNKS.header, data: Buffer.concat([size, Buffer.from(INDEXED_8_BIT)]) }),
    chunk({
      type: CHUNKS.palette,
      data: Buffer.from(colours.flatMap(({ red, green, blue }) => [red, green, blue])),
    }),
    chunk({ type: CHUNKS.transparency, data: Buffer.from(colours.map(({ alpha }) => alpha)) }),
    chunk({ type: CHUNKS.data, data: deflateSync(rows.bytes) }),
    chunk({ type: CHUNKS.end, data: Buffer.alloc(0) }),
  ])
}

/** One picture of a display set as a PNG, and the size it comes out at. */
export type PgsPng = { png: Buffer; width: number; height: number }

/** The picture a composition shows, as a PNG: its object's pixels in its palette's colours, cropped if it says so. */
export const pgsPngOf = ({ object, palette, crop }: PgsPicture): PgsPng => {
  const whole = rowsOf(object)
  const rows = crop === null ? whole : cropped({ rows: whole, crop })
  return { png: indexedPng({ rows, palette }), width: rows.width, height: rows.height }
}
