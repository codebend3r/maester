import { describe, expect, it } from 'bun:test'
import { DiskFullError, opfsDisk } from '@/browserDownloads/disk'
import { fakeStorage, storageOf } from '@/test/opfs'

const PATH = ['downloads', 'account', 'one', 'media.mp4'] as const

const bytes = (...values: number[]) => Uint8Array.from(values)

const textOf = async (blob: Blob | null) =>
  blob === null ? null : [...new Uint8Array(await blob.arrayBuffer())]

describe('opfsDisk', () => {
  it('has no bytes and no file where nothing was written', async () => {
    const disk = opfsDisk(storageOf(fakeStorage()))
    expect(await disk.size(PATH)).toBe(0)
    expect(await disk.read(PATH)).toBeNull()
  })

  it('keeps what a writer wrote only once it commits or closes', async () => {
    const disk = opfsDisk(storageOf(fakeStorage()))
    const writer = await disk.open({ path: PATH, from: 0 })
    await writer.write(bytes(1, 2))
    expect(await disk.size(PATH)).toBe(0)
    await writer.commit()
    expect(await disk.size(PATH)).toBe(2)
    await writer.write(bytes(3))
    await writer.close()
    expect(await textOf(await disk.read(PATH))).toEqual([1, 2, 3])
  })

  it('appends after the bytes it is told to keep, dropping what lay past them', async () => {
    const disk = opfsDisk(storageOf(fakeStorage()))
    const first = await disk.open({ path: PATH, from: 0 })
    await first.write(bytes(1, 2, 3, 4))
    await first.close()
    const second = await disk.open({ path: PATH, from: 2 })
    await second.write(bytes(9))
    await second.close()
    expect(await textOf(await disk.read(PATH))).toEqual([1, 2, 9])
  })

  it('writes and reads a small file whole, text or picture', async () => {
    const disk = opfsDisk(storageOf(fakeStorage()))
    await disk.write({ path: ['downloads', 'index.json'], data: '{"version":1}' })
    await disk.write({ path: ['downloads', 'a', 'poster.jpg'], data: new Blob(['jpeg']) })
    expect((await (await disk.read(['downloads', 'index.json']))?.text()) ?? null).toBe(
      '{"version":1}',
    )
    expect((await (await disk.read(['downloads', 'a', 'poster.jpg']))?.text()) ?? null).toBe('jpeg')
  })

  it('removes a file, or a folder and all in it, and takes one already gone as gone', async () => {
    const fake = fakeStorage()
    const disk = opfsDisk(storageOf(fake))
    await disk.write({ path: PATH, data: 'video' })
    await disk.write({ path: ['downloads', 'account', 'one', 'subtitles', '0.vtt'], data: 'vtt' })
    await disk.remove(['downloads', 'account', 'one'])
    expect(await disk.read(PATH)).toBeNull()
    expect(fake.sizeOf()).toBe(0)
    await disk.remove(['downloads', 'account', 'one'])
    await disk.remove(['nowhere', 'at', 'all'])
  })

  it("names the quota's refusal, in a write and in a commit", async () => {
    const disk = opfsDisk(storageOf(fakeStorage({ quota: 3 })))
    const writer = await disk.open({ path: PATH, from: 0 })
    await writer.write(bytes(1, 2))
    await expect(writer.write(bytes(3, 4))).rejects.toBeInstanceOf(DiskFullError)
    await expect(
      disk.write({ path: ['downloads', 'big'], data: 'too much' }),
    ).rejects.toBeInstanceOf(DiskFullError)
  })

  it('lets any other failure through as it is', async () => {
    const storage = storageOf(fakeStorage())
    const disk = opfsDisk({
      ...storage,
      getDirectory: async () => {
        throw new TypeError('The file system is not there.')
      },
    })
    await expect(disk.size(PATH)).rejects.toBeInstanceOf(TypeError)
    await expect(disk.write({ path: PATH, data: 'x' })).rejects.toBeInstanceOf(TypeError)
  })

  it("reads the origin's room, and asks the browser to keep it", async () => {
    const fake = fakeStorage({ quota: 100 })
    const disk = opfsDisk(storageOf(fake))
    await disk.write({ path: PATH, data: 'video' })
    expect(await disk.space()).toEqual({ usage: 5, quota: 100 })
    await disk.persist()
    expect(fake.calls.persisted).toBe(1)
  })

  it('reads no room as none, where the browser will not say', async () => {
    const disk = opfsDisk({ ...storageOf(fakeStorage()), estimate: async () => ({}) })
    expect(await disk.space()).toEqual({ usage: 0, quota: 0 })
  })
})
