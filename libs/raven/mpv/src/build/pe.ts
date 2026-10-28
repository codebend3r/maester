// A reader for the parts of a Windows PE file the audit looks at: the machine the
// code is for, the DLLs it imports and the names it exports. The platform's own
// tools (dumpbin, objdump) are not on every machine the audit runs on, and the
// format is small enough to read directly.

const DOS_MAGIC = 0x5a4d
const PE_SIGNATURE = 0x00004550
const PE32_PLUS = 0x20b
const PE_OFFSET_FIELD = 0x3c
const SECTION_HEADER_SIZE = 40
const IMPORT_DESCRIPTOR_SIZE = 20

/** The machine field of a PE header, for the one architecture Raven ships on Windows. */
export const PE_MACHINES = { x64: 0x8664 } as const

const DATA_DIRECTORIES = { exports: 0, imports: 1 } as const

export type PeInfo = {
  machine: number
  imports: readonly string[]
  exports: readonly string[]
}

type Section = {
  virtualAddress: number
  virtualSize: number
  rawOffset: number
  rawSize: number
}

type ReadPeProps = {
  bytes: Uint8Array
}

export const readPe = ({ bytes }: ReadPeProps): PeInfo => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < PE_OFFSET_FIELD + 4 || view.getUint16(0, true) !== DOS_MAGIC)
    throw new Error('Not a PE file: no DOS header')
  const pe = view.getUint32(PE_OFFSET_FIELD, true)
  if (pe + 24 > bytes.byteLength || view.getUint32(pe, true) !== PE_SIGNATURE)
    throw new Error('Not a PE file: no PE signature')
  const machine = view.getUint16(pe + 4, true)
  const sectionCount = view.getUint16(pe + 6, true)
  const optionalHeaderSize = view.getUint16(pe + 20, true)
  const optional = pe + 24
  if (view.getUint16(optional, true) !== PE32_PLUS) throw new Error('Not a 64-bit PE file')
  // PE32+ keeps its data directories 112 bytes into the optional header.
  const directories = optional + 112
  const sectionsAt = optional + optionalHeaderSize
  const sections = Array.from({ length: sectionCount }, (_, index): Section => {
    const at = sectionsAt + index * SECTION_HEADER_SIZE
    return {
      virtualSize: view.getUint32(at + 8, true),
      virtualAddress: view.getUint32(at + 12, true),
      rawSize: view.getUint32(at + 16, true),
      rawOffset: view.getUint32(at + 20, true),
    }
  })

  const offsetOf = (rva: number): number => {
    const section = sections.find(
      (candidate) =>
        rva >= candidate.virtualAddress &&
        rva < candidate.virtualAddress + Math.max(candidate.virtualSize, candidate.rawSize),
    )
    if (section === undefined) throw new Error(`Address outside every section: ${rva}`)
    return rva - section.virtualAddress + section.rawOffset
  }

  const stringAt = (offset: number): string => {
    const end = bytes.indexOf(0, offset)
    if (end === -1) throw new Error('Unterminated name')
    return new TextDecoder().decode(bytes.subarray(offset, end))
  }

  const directory = (index: number): number => view.getUint32(directories + index * 8, true)

  type ImportsFromProps = {
    at: number
    found: readonly string[]
  }

  const importsFrom = ({ at, found }: ImportsFromProps): readonly string[] => {
    const name = view.getUint32(at + 12, true)
    return name === 0
      ? found
      : importsFrom({
          at: at + IMPORT_DESCRIPTOR_SIZE,
          found: [...found, stringAt(offsetOf(name))],
        })
  }
  const importTable = directory(DATA_DIRECTORIES.imports)
  const imports = importTable === 0 ? [] : importsFrom({ at: offsetOf(importTable), found: [] })

  const exportTable = directory(DATA_DIRECTORIES.exports)
  const exportsOf = (): readonly string[] => {
    if (exportTable === 0) return []
    const table = offsetOf(exportTable)
    const nameCount = view.getUint32(table + 24, true)
    const names = offsetOf(view.getUint32(table + 32, true))
    return Array.from({ length: nameCount }, (_, index) =>
      stringAt(offsetOf(view.getUint32(names + index * 4, true))),
    )
  }

  return { machine, imports, exports: exportsOf() }
}
