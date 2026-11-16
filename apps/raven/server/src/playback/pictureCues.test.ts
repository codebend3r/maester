import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { pictureCuesOf } from '@/playback/pictureCues'
import { PGS_BOX, pgsBytes } from '@/test/clips'

const FRAME = { width: 320, height: 240 }

const sup = Buffer.from(
  pgsBytes({
    ...FRAME,
    cues: [
      { start: 1, end: 3 },
      { start: 7, end: 9 },
    ],
  }),
)

/** Where the box sits: centred, eight pixels above the foot of the frame. */
const BOX_AT = {
  x: (FRAME.width - PGS_BOX.width) / 2,
  y: FRAME.height - PGS_BOX.height - 8,
}

type Chunk = { type: string; data: Buffer }

type ChunkRead = { at: number; chunks: Chunk[] }

/** A PNG's chunks, after its eight byte signature, read as far as the file goes. */
const chunksOf = (png: Buffer): Chunk[] =>
  Array.from({ length: Math.floor(png.length / 12) }).reduce<ChunkRead>(
    (read) => {
      const { at, chunks } = read
      if (at + 12 > png.length) return read
      const length = png.readUInt32BE(at)
      const chunk = {
        type: png.toString('latin1', at + 4, at + 8),
        data: png.subarray(at + 8, at + 8 + length),
      }
      return { at: at + 12 + length, chunks: [...chunks, chunk] }
    },
    { at: 8, chunks: [] },
  ).chunks

/** The colour and opacity of a PNG's top left pixel, read back through its palette. */
const firstPixelOf = (base64: string) => {
  const chunks = chunksOf(Buffer.from(base64, 'base64'))
  const dataOf = (type: string): Buffer =>
    chunks.find((chunk) => chunk.type === type)?.data ?? Buffer.alloc(0)
  // Each row opens with its filter byte, so the first pixel's index is the second byte.
  const index = inflateSync(dataOf('IDAT')).readUInt8(1)
  const palette = dataOf('PLTE')
  return {
    red: palette.readUInt8(index * 3),
    green: palette.readUInt8(index * 3 + 1),
    blue: palette.readUInt8(index * 3 + 2),
    alpha: dataOf('tRNS').readUInt8(index),
  }
}

describe('pictureCuesOf', () => {
  it('reads each display set that shows something as a cue, to the set that clears it', () => {
    const cues = pictureCuesOf({ sup, end: 300, isHdr: false })
    expect(cues.map(({ start, end, canvas }) => ({ start, end, canvas }))).toEqual([
      { start: 1, end: 3, canvas: FRAME },
      { start: 7, end: 9, canvas: FRAME },
    ])
    expect(
      cues.map(({ pictures }) =>
        pictures.map(({ x, y, width, height }) => ({ x, y, width, height })),
      ),
    ).toEqual([[{ ...BOX_AT, ...PGS_BOX }], [{ ...BOX_AT, ...PGS_BOX }]])
  })

  it("draws the picture as a PNG in the palette's colours", () => {
    const [cue] = pictureCuesOf({ sup, end: 300, isHdr: false })
    const png = Buffer.from(cue?.pictures[0]?.png ?? '', 'base64')
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(PGS_BOX)
    expect(firstPixelOf(cue?.pictures[0]?.png ?? '')).toEqual({
      red: 255,
      green: 255,
      blue: 255,
      alpha: 255,
    })
  })

  it('cuts a cue still up where the stretch ends short at that end', () => {
    // The stretch stops before the second box's clearing set.
    const cut = sup.subarray(0, sup.length - 47)
    const cues = pictureCuesOf({ sup: cut, end: 8, isHdr: false })
    expect(cues.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 1, end: 3 },
      { start: 7, end: 8 },
    ])
  })

  it('reads nothing from bytes that are no PGS stream', () => {
    expect(pictureCuesOf({ sup: Buffer.from('WEBVTT\n\n'), end: 300, isHdr: false })).toEqual([])
    expect(pictureCuesOf({ sup: Buffer.alloc(0), end: 300, isHdr: false })).toEqual([])
  })

  it("lifts an HDR disc's mid grey text, written on the picture's PQ curve, to white", () => {
    // Luma 152 is where a UHD Blu-ray puts white text; as SDR it would be a dim grey.
    const grey = Buffer.from(sup)
    const palette = grey.indexOf(Buffer.from([0, 0, 1, 235, 128, 128, 255]))
    grey.writeUInt8(152, palette + 3)
    const [sdr] = pictureCuesOf({ sup: grey, end: 300, isHdr: false })
    const [hdr] = pictureCuesOf({ sup: grey, end: 300, isHdr: true })
    expect(firstPixelOf(sdr?.pictures[0]?.png ?? '').red).toBeLessThan(170)
    expect(firstPixelOf(hdr?.pictures[0]?.png ?? '').red).toBe(255)
  })
})
