import { describe, expect, it } from 'vitest'
import { MP4_BOXES, segmentFileName, segmentNumberOf, splitSegmentFile } from '@/hls/segmentFiles'

const box = ({ type, body }: { type: string; body: number[] }): number[] => {
  const size = 8 + body.length
  return [
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...Array.from(type, (letter) => letter.charCodeAt(0)),
    ...body,
  ]
}

const LARGE_SIZE = 1

/** A box whose size sits in the 64-bit field after its type. */
const largeBox = ({ type, body }: { type: string; body: number[] }): number[] => {
  const size = 16 + body.length
  return [
    0,
    0,
    0,
    LARGE_SIZE,
    ...Array.from(type, (letter) => letter.charCodeAt(0)),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    size,
    ...body,
  ]
}

describe('splitSegmentFile', () => {
  const ftyp = box({ type: MP4_BOXES.fileType, body: [1, 2, 3, 4] })
  const moov = box({ type: MP4_BOXES.movie, body: [5, 6] })
  const moof = box({ type: MP4_BOXES.fragment, body: [7] })
  const mdat = largeBox({ type: MP4_BOXES.mediaData, body: [8, 9, 10] })

  it('cuts after the moov: the init before it, the segment after', () => {
    const { init, media } = splitSegmentFile(Uint8Array.from([...ftyp, ...moov, ...moof, ...mdat]))

    expect([...init]).toEqual([...ftyp, ...moov])
    expect([...media]).toEqual([...moof, ...mdat])
  })

  it('refuses a file whose last box runs past its end, as one still being written does', () => {
    const whole = [...ftyp, ...moov, ...moof, ...mdat]

    expect(() => splitSegmentFile(Uint8Array.from(whole.slice(0, -1)))).toThrow(/past the end/)
  })

  it('refuses a file with no moov', () => {
    expect(() => splitSegmentFile(Uint8Array.from([...ftyp, ...moof]))).toThrow(/moov/)
  })
})

describe('segment file names', () => {
  it('names a segment by its number and reads the number back', () => {
    expect(segmentFileName(12)).toBe('seg_12.mp4')
    expect(segmentNumberOf('seg_12.mp4')).toBe(12)
  })

  it('reads nothing from another name', () => {
    expect(segmentNumberOf('seg_.mp4')).toBeNull()
    expect(segmentNumberOf('seg_1a.mp4')).toBeNull()
    expect(segmentNumberOf('list.m3u8')).toBeNull()
  })
})
