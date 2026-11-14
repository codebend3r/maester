import { describe, expect, it, mock } from 'bun:test'

/** The files the fake disk holds, by path, each with its size as iOS reports one: a BigInt. */
const files = new Map<string, bigint>()

const DOCUMENTS = 'documents'

const pathIn = (parts: readonly unknown[]): string =>
  parts
    .map((part) => (part instanceof FakeFile ? part.path : String(part)))
    .filter((part) => part !== DOCUMENTS)
    .join('/')

class FakeDirectory {
  readonly path: string
  constructor(...parts: unknown[]) {
    this.path = pathIn(parts)
  }
  get exists(): boolean {
    return [...files.keys()].some((file) => file.startsWith(`${this.path}/`))
  }
  create(): void {}
  delete(): void {
    ;[...files.keys()]
      .filter((file) => file.startsWith(`${this.path}/`))
      .forEach((file) => files.delete(file))
  }
  list(): FakeDirectory[] {
    return []
  }
}

class FakeFile {
  readonly path: string
  constructor(...parts: unknown[]) {
    this.path = pathIn(parts)
  }
  get exists(): boolean {
    return files.has(this.path)
  }
  get size(): bigint {
    return files.get(this.path) ?? BigInt(0)
  }
  get uri(): string {
    return `file:///${this.path}`
  }
  get parentDirectory(): FakeDirectory {
    return new FakeDirectory(this.path.split('/').slice(0, -1).join('/'))
  }
  delete(): void {
    files.delete(this.path)
  }
  moveSync(to: FakeFile): void {
    files.set(to.path, this.size)
    files.delete(this.path)
  }
  static createDownloadTask(_uri: string, part: FakeFile) {
    return {
      downloadAsync: async () => {
        files.set(part.path, BigInt(4_200_000))
        return part
      },
    }
  }
}

// expo-file-system's module reaches the native side, which bun cannot load.
mock.module('expo-file-system', () => ({
  File: FakeFile,
  Directory: FakeDirectory,
  Paths: { document: DOCUMENTS, availableDiskSpace: BigInt(64_000_000_000) },
}))

const { DISK_TRANSFERS, deviceDiskFor } = await import('@/downloads/deviceDisk')

describe('deviceDiskFor', () => {
  it('hands back a BigInt size as a number, so the bytes add up and persist', async () => {
    const disk = deviceDiskFor({ transfer: DISK_TRANSFERS.task })
    const bytes = await disk.fetch({
      source: { uri: 'https://raven.test/media/7', headers: {} },
      path: 'downloads/s1/7/media.m4a',
      signal: null,
      onProgress: null,
    })
    expect(bytes).toBe(4_200_000)
    expect(typeof bytes).toBe('number')
    expect(bytes + 1).toBe(4_200_001)
    expect(files.has('downloads/s1/7/media.m4a')).toBe(true)
    expect(files.has('downloads/s1/7/media.m4a.part')).toBe(false)
    expect(disk.freeBytes()).toBe(64_000_000_000)
  })
})
