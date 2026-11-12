import { describe, expect, it } from 'bun:test'
import { canKeepDownloads, type DownloadsWindow } from '@/browserDownloads/support'

const able = (overrides: Partial<DownloadsWindow> = {}): DownloadsWindow => ({
  isSecureContext: true,
  navigator: { storage: { getDirectory: () => undefined } },
  FileSystemFileHandle: { prototype: { createWritable: () => undefined } },
  ...overrides,
})

describe('canKeepDownloads', () => {
  it('says yes to a secure page with a private file system it can write to', () => {
    expect(canKeepDownloads(able())).toBe(true)
  })

  it('says no on an insecure page', () => {
    expect(canKeepDownloads(able({ isSecureContext: false }))).toBe(false)
  })

  it('says no without the private file system', () => {
    expect(canKeepDownloads(able({ navigator: {} }))).toBe(false)
    expect(canKeepDownloads(able({ navigator: { storage: {} } }))).toBe(false)
  })

  it('says no where a file cannot be written from the page', () => {
    expect(canKeepDownloads(able({ FileSystemFileHandle: { prototype: {} } }))).toBe(false)
    expect(canKeepDownloads(able({ FileSystemFileHandle: undefined }))).toBe(false)
  })
})
