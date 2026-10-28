import { describe, expect, test } from 'bun:test'
import { PE_MACHINES, readPe } from '@/pe'

// A 64-bit PE with one section holding an import table, an export table and their
// names: the smallest file the reader has to understand.
const SECTION_RVA = 0x1000
const SECTION_OFFSET = 0x200
const PE_HEADER = 0x80
const OPTIONAL_HEADER_SIZE = 240

type SyntheticPeProps = {
  machine: number
  imports: readonly string[]
  exports: readonly string[]
}

const syntheticPe = ({ machine, imports, exports }: SyntheticPeProps): Uint8Array => {
  const bytes = new Uint8Array(0x1000)
  const view = new DataView(bytes.buffer)
  const encoder = new TextEncoder()
  const strings = [...imports, ...exports]
  const importTableSize = (imports.length + 1) * 20
  const exportDirectory = importTableSize
  const namePointers = exportDirectory + 40
  const stringsAt = namePointers + exports.length * 4
  const stringOffsets = strings.reduce<{ offsets: readonly number[]; next: number }>(
    ({ offsets, next }, name) => ({ offsets: [...offsets, next], next: next + name.length + 1 }),
    { offsets: [], next: stringsAt },
  ).offsets
  strings.map((name, index) =>
    bytes.set(encoder.encode(name), SECTION_OFFSET + (stringOffsets[index] ?? 0)),
  )

  view.setUint16(0, 0x5a4d, true)
  view.setUint32(0x3c, PE_HEADER, true)
  view.setUint32(PE_HEADER, 0x00004550, true)
  view.setUint16(PE_HEADER + 4, machine, true)
  view.setUint16(PE_HEADER + 6, 1, true)
  view.setUint16(PE_HEADER + 20, OPTIONAL_HEADER_SIZE, true)
  const optional = PE_HEADER + 24
  view.setUint16(optional, 0x20b, true)
  const directories = optional + 112
  view.setUint32(directories, SECTION_RVA + exportDirectory, true)
  view.setUint32(directories + 4, 40, true)
  view.setUint32(directories + 8, SECTION_RVA, true)
  view.setUint32(directories + 12, importTableSize, true)
  const section = optional + OPTIONAL_HEADER_SIZE
  view.setUint32(section + 8, 0x400, true)
  view.setUint32(section + 12, SECTION_RVA, true)
  view.setUint32(section + 16, 0x400, true)
  view.setUint32(section + 20, SECTION_OFFSET, true)

  imports.map((_, index) =>
    view.setUint32(
      SECTION_OFFSET + index * 20 + 12,
      SECTION_RVA + (stringOffsets[index] ?? 0),
      true,
    ),
  )
  view.setUint32(SECTION_OFFSET + exportDirectory + 24, exports.length, true)
  view.setUint32(SECTION_OFFSET + exportDirectory + 32, SECTION_RVA + namePointers, true)
  exports.map((_, index) =>
    view.setUint32(
      SECTION_OFFSET + namePointers + index * 4,
      SECTION_RVA + (stringOffsets[imports.length + index] ?? 0),
      true,
    ),
  )
  return bytes
}

describe('readPe', () => {
  test('reads the machine, the imported DLLs and the exported names', () => {
    const bytes = syntheticPe({
      machine: PE_MACHINES.x64,
      imports: ['KERNEL32.dll', 'vulkan-1.dll'],
      exports: ['mpv_create', 'mpv_initialize'],
    })
    expect(readPe({ bytes })).toEqual({
      machine: PE_MACHINES.x64,
      imports: ['KERNEL32.dll', 'vulkan-1.dll'],
      exports: ['mpv_create', 'mpv_initialize'],
    })
  })

  test('reads a file with no imports or exports', () => {
    expect(readPe({ bytes: syntheticPe({ machine: 0x14c, imports: [], exports: [] }) })).toEqual({
      machine: 0x14c,
      imports: [],
      exports: [],
    })
  })

  test('rejects what is not a 64-bit PE file', () => {
    expect(() => readPe({ bytes: new Uint8Array(16) })).toThrow('no DOS header')
    const noSignature = syntheticPe({ machine: PE_MACHINES.x64, imports: [], exports: [] })
    noSignature[PE_HEADER] = 0
    expect(() => readPe({ bytes: noSignature })).toThrow('no PE signature')
    const pe32 = syntheticPe({ machine: PE_MACHINES.x64, imports: [], exports: [] })
    new DataView(pe32.buffer).setUint16(PE_HEADER + 24, 0x10b, true)
    expect(() => readPe({ bytes: pe32 })).toThrow('64-bit')
  })
})
