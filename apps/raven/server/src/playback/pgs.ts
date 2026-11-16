/** A PGS segment's type, as a Blu-ray's subtitle stream names it. */
export const PGS_SEGMENTS = {
  palette: 0x14,
  object: 0x15,
  presentation: 0x16,
  window: 0x17,
  end: 0x80,
} as const

/** The 90 kHz clock PGS stamps its segments with. */
export const PGS_CLOCK = 90_000

/** "PG", which opens every segment of a `.sup` stream. */
const MAGIC = 0x5047

/** A segment's header: the magic, its time, a decode time, its type and its data's size. */
const HEADER_BYTES = 13

type Segment = { pts: number; type: number; data: Buffer }

type SegmentRead = { at: number; segments: Segment[] }

/**
 * The stream's segments, in order. Each says how long it is, so they are read one after the
 * other, at most as many times as the smallest segments would fit; the read stops at the first
 * byte that opens no segment, or at one cut short.
 */
const segmentsOf = (sup: Buffer): Segment[] =>
  Array.from({ length: Math.floor(sup.length / HEADER_BYTES) }).reduce<SegmentRead>(
    (read) => {
      const { at, segments } = read
      if (at + HEADER_BYTES > sup.length || sup.readUInt16BE(at) !== MAGIC) return read
      const end = at + HEADER_BYTES + sup.readUInt16BE(at + 11)
      if (end > sup.length) return { at: sup.length, segments }
      const segment = {
        pts: sup.readUInt32BE(at + 2) / PGS_CLOCK,
        type: sup.readUInt8(at + 10),
        data: sup.subarray(at + HEADER_BYTES, end),
      }
      return { at: end, segments: [...segments, segment] }
    },
    { at: 0, segments: [] },
  ).segments

type SetRead = { open: Segment[] | null; sets: Segment[][] }

/** The segments by display set: each runs from its presentation segment to its end segment. */
const displaySetsOf = (segments: readonly Segment[]): Segment[][] =>
  segments.reduce<SetRead>(
    ({ open, sets }, segment) => {
      if (segment.type === PGS_SEGMENTS.presentation) return { open: [segment], sets }
      if (open === null) return { open, sets }
      return segment.type === PGS_SEGMENTS.end
        ? { open: null, sets: [...sets, open] }
        : { open: [...open, segment], sets }
    },
    { open: null, sets: [] },
  ).sets

/** One palette entry as a picture file takes it: red, green, blue and how opaque, each 0 to 255. */
type PgsColour = { red: number; green: number; blue: number; alpha: number }

/** A palette: its entries by the index a pixel names. */
export type PgsPalette = ReadonlyMap<number, PgsColour>

/** A picture as the disc holds it: its size, and its pixels as run-length coded palette indexes. */
export type PgsObject = { width: number; height: number; rle: Buffer }

/** The part of an object a composition shows. */
export type PgsCrop = { x: number; y: number; width: number; height: number }

type Composition = { objectId: number; x: number; y: number; crop: PgsCrop | null }

type Presentation = {
  width: number
  height: number
  isEpochStart: boolean
  paletteId: number
  compositions: Composition[]
}

/** A composition's flags: whether it shows only a part of its object. */
const CROPPED = 0x80

/** A presentation segment's state, when it opens an epoch: nothing before it is used again. */
const EPOCH_START = 0x80

/** Where a presentation segment's compositions begin, and how long each is, uncropped and cropped. */
const COMPOSITIONS_AT = 11
const COMPOSITION_BYTES = 8
const CROP_BYTES = 8

type CompositionRead = { at: number; compositions: Composition[] }

const presentationOf = (data: Buffer): Presentation | null => {
  if (data.length < COMPOSITIONS_AT) return null
  const { compositions } = Array.from({ length: data.readUInt8(10) }).reduce<CompositionRead>(
    (read) => {
      const { at } = read
      if (at + COMPOSITION_BYTES > data.length) return read
      const isCropped = (data.readUInt8(at + 3) & CROPPED) !== 0
      const cropAt = at + COMPOSITION_BYTES
      if (isCropped && cropAt + CROP_BYTES > data.length) return read
      const crop = isCropped
        ? {
            x: data.readUInt16BE(cropAt),
            y: data.readUInt16BE(cropAt + 2),
            width: data.readUInt16BE(cropAt + 4),
            height: data.readUInt16BE(cropAt + 6),
          }
        : null
      const composition = {
        objectId: data.readUInt16BE(at),
        x: data.readUInt16BE(at + 4),
        y: data.readUInt16BE(at + 6),
        crop,
      }
      return {
        at: cropAt + (isCropped ? CROP_BYTES : 0),
        compositions: [...read.compositions, composition],
      }
    },
    { at: COMPOSITIONS_AT, compositions: [] },
  )
  return {
    width: data.readUInt16BE(0),
    height: data.readUInt16BE(2),
    isEpochStart: (data.readUInt8(7) & EPOCH_START) !== 0,
    paletteId: data.readUInt8(9),
    compositions,
  }
}

/** Frames this tall or shorter are standard definition, whose colours are BT.601's; taller ones are BT.709's. */
const SD_HEIGHT = 576

type Matrix = { redCr: number; greenCb: number; greenCr: number; blueCb: number }

const BT601 = { redCr: 1.596, greenCb: 0.392, greenCr: 0.813, blueCb: 2.017 } as const
const BT709 = { redCr: 1.793, greenCb: 0.213, greenCr: 0.533, blueCb: 2.112 } as const

const channel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

/** SMPTE ST 2084's constants, the PQ curve an HDR10 picture's values are on. */
const PQ = {
  m1: 0.1593017578125,
  m2: 78.84375,
  c1: 0.8359375,
  c2: 18.8515625,
  c3: 18.6875,
} as const

/** The light a PQ signal of 1 stands for, and the light of an HDR picture's reference white, in nits. */
const PQ_PEAK_NITS = 10_000
const REFERENCE_WHITE_NITS = 203

/**
 * A channel of an HDR disc's subtitle as a screen's own: the disc writes its palette on the
 * picture's PQ curve, where white text is a mid grey value, so read as it is the text comes out
 * dim. The value becomes light, reference white becomes the screen's white (brighter clips to
 * it), and the light goes back on sRGB's curve.
 */
const pqToScreen = (value: number): number => {
  const signal = (Math.max(0, Math.min(255, value)) / 255) ** (1 / PQ.m2)
  const nits =
    (Math.max(signal - PQ.c1, 0) / (PQ.c2 - PQ.c3 * signal)) ** (1 / PQ.m1) * PQ_PEAK_NITS
  const light = Math.min(1, nits / REFERENCE_WHITE_NITS)
  return (light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055) * 255
}

/** How a palette's values become a screen's: by the frame's matrix, and off the PQ curve for an HDR picture. */
type Colours = { matrix: Matrix; isHdr: boolean }

type ColourOfProps = { luma: number; cr: number; cb: number; alpha: number; colours: Colours }

/** A palette entry's limited-range Y'CbCr as full-range RGB. */
const colourOf = ({ luma, cr, cb, alpha, colours }: ColourOfProps): PgsColour => {
  const { matrix, isHdr } = colours
  const light = (luma - 16) * 1.164
  const onScreen = (value: number): number => channel(isHdr ? pqToScreen(value) : value)
  return {
    red: onScreen(light + matrix.redCr * (cr - 128)),
    green: onScreen(light - matrix.greenCb * (cb - 128) - matrix.greenCr * (cr - 128)),
    blue: onScreen(light + matrix.blueCb * (cb - 128)),
    alpha,
  }
}

/** A palette segment's entries begin after its id and version, five bytes each. */
const PALETTE_ENTRIES_AT = 2
const PALETTE_ENTRY_BYTES = 5

type PaletteEntriesOfProps = { data: Buffer; colours: Colours }

const paletteEntriesOf = ({ data, colours }: PaletteEntriesOfProps): [number, PgsColour][] =>
  Array.from(
    { length: Math.floor((data.length - PALETTE_ENTRIES_AT) / PALETTE_ENTRY_BYTES) },
    (_, index): [number, PgsColour] => {
      const at = PALETTE_ENTRIES_AT + index * PALETTE_ENTRY_BYTES
      return [
        data.readUInt8(at),
        colourOf({
          luma: data.readUInt8(at + 1),
          cr: data.readUInt8(at + 2),
          cb: data.readUInt8(at + 3),
          alpha: data.readUInt8(at + 4),
          colours,
        }),
      ]
    },
  )

/** An object segment's flags: the first fragment of its object, which says the object's size. */
const FIRST_FRAGMENT = 0x80

/** Where an object's pixels begin in its first fragment (after its size) and in each later one. */
const FIRST_PIXELS_AT = 11
const NEXT_PIXELS_AT = 4

/** What an epoch has defined so far, which a later display set of the epoch may show again. */
type Epoch = {
  objects: ReadonlyMap<number, PgsObject>
  palettes: ReadonlyMap<number, PgsPalette>
}

const NEW_EPOCH: Epoch = { objects: new Map(), palettes: new Map() }

type ObjectOfProps = { data: Buffer; before: PgsObject | undefined }

/** The object an object segment leaves: a first fragment's own, or `before` with a later one's pixels. */
const objectOf = ({ data, before }: ObjectOfProps): PgsObject | null => {
  if ((data.readUInt8(3) & FIRST_FRAGMENT) !== 0) {
    return data.length < FIRST_PIXELS_AT
      ? null
      : {
          width: data.readUInt16BE(7),
          height: data.readUInt16BE(9),
          rle: data.subarray(FIRST_PIXELS_AT),
        }
  }
  return before === undefined
    ? null
    : { ...before, rle: Buffer.concat([before.rle, data.subarray(NEXT_PIXELS_AT)]) }
}

type DefineProps = { epoch: Epoch; segment: Segment; colours: Colours }

/** The epoch with what a palette or object segment defines; any other segment changes nothing. */
const define = ({ epoch, segment: { type, data }, colours }: DefineProps): Epoch => {
  if (type === PGS_SEGMENTS.palette && data.length >= PALETTE_ENTRIES_AT) {
    const id = data.readUInt8(0)
    const entries = [...(epoch.palettes.get(id) ?? []), ...paletteEntriesOf({ data, colours })]
    return { ...epoch, palettes: new Map([...epoch.palettes, [id, new Map(entries)]]) }
  }
  if (type !== PGS_SEGMENTS.object || data.length < NEXT_PIXELS_AT) return epoch
  const id = data.readUInt16BE(0)
  const object = objectOf({ data, before: epoch.objects.get(id) })
  return object === null ? epoch : { ...epoch, objects: new Map([...epoch.objects, [id, object]]) }
}

/** One picture a display set shows: the object, its colours, the part shown and where on the canvas. */
export type PgsPicture = {
  x: number
  y: number
  object: PgsObject
  palette: PgsPalette
  crop: PgsCrop | null
}

/**
 * What the screen holds from `pts` until the next display set: the pictures, on a canvas the
 * size of the video's frame. A set with no picture clears the screen.
 */
export type PgsDisplay = {
  pts: number
  canvas: { width: number; height: number }
  pictures: PgsPicture[]
}

type DisplayRead = { epoch: Epoch; displays: PgsDisplay[] }

type ReadPgsProps = { sup: Buffer; isHdr: boolean }

/**
 * A `.sup` stream's display sets, in order, each with the pictures it shows resolved against
 * what its epoch has defined. A set that names an object or palette the stream never defined (one
 * cut from the middle of an epoch) shows only what it can. `isHdr` says the video is HDR, whose
 * disc writes the subtitle's colours on the picture's PQ curve.
 */
export const readPgs = ({ sup, isHdr }: ReadPgsProps): PgsDisplay[] =>
  displaySetsOf(segmentsOf(sup)).reduce<DisplayRead>(
    (read, [first, ...rest]) => {
      const presentation = first === undefined ? null : presentationOf(first.data)
      if (first === undefined || presentation === null) return read
      const colours = { matrix: presentation.height > SD_HEIGHT ? BT709 : BT601, isHdr }
      const epoch = rest.reduce<Epoch>(
        (defined, segment) => define({ epoch: defined, segment, colours }),
        presentation.isEpochStart ? NEW_EPOCH : read.epoch,
      )
      const palette = epoch.palettes.get(presentation.paletteId)
      const pictures = presentation.compositions.flatMap(({ objectId, x, y, crop }) => {
        const object = epoch.objects.get(objectId)
        return object === undefined || palette === undefined
          ? []
          : [{ x, y, object, palette, crop }]
      })
      const display = {
        pts: first.pts,
        canvas: { width: presentation.width, height: presentation.height },
        pictures,
      }
      return { epoch, displays: [...read.displays, display] }
    },
    { epoch: NEW_EPOCH, displays: [] },
  ).displays
