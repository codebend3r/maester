import { HTTP_METHODS, PICTURE_SCHEME, pictureUrlFor } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { createPictureHandler } from '@/main/pictureProtocol'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

const PICTURE_ID = '9b2d7c1e-5a40-4f0c-8a11-3c2e1d0f9a77'
const OTHER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const PATH = '/data/downloads/server/pictures/item-12/poster.jpg'
const BYTES = new Uint8Array([1, 2, 3, 4])

type SetupProps = { isOnDisk?: boolean }

const setup = ({ isOnDisk = true }: SetupProps = {}) => {
  const lookups: string[] = []
  const reads: string[] = []
  const handler = createPictureHandler({
    pictures: {
      fileOf: (pictureId) => {
        lookups.push(pictureId)
        return pictureId === PICTURE_ID ? { path: PATH, contentType: 'image/jpeg' } : null
      },
    },
    readFile: async (path) => {
      reads.push(path)
      if (!isOnDisk) throw new Error('ENOENT')
      return BYTES
    },
  })
  return { handler, lookups, reads }
}

describe('createPictureHandler', () => {
  it('answers a saved picture whole, by its id, with its type and no sniffing', async () => {
    const world = setup()
    const response = await world.handler(new Request(pictureUrlFor(PICTURE_ID)))
    expect(response.status).toBe(200)
    expect(response.headers.get(HTTP_HEADERS.contentType)).toBe('image/jpeg')
    expect(response.headers.get(HTTP_HEADERS.contentLength)).toBe('4')
    expect(response.headers.get(HTTP_HEADERS.contentTypeOptions)).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
    expect(world.lookups).toEqual([PICTURE_ID])
    expect(world.reads).toEqual([PATH])
  })

  it('answers HEAD with the headers and no body', async () => {
    const world = setup()
    const response = await world.handler(
      new Request(pictureUrlFor(PICTURE_ID), { method: HTTP_METHODS.head }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get(HTTP_HEADERS.contentLength)).toBe('4')
    expect((await response.arrayBuffer()).byteLength).toBe(0)
  })

  it('finds nothing for an id no download holds, and reads no file for it', async () => {
    const world = setup()
    expect((await world.handler(new Request(pictureUrlFor(OTHER_ID)))).status).toBe(404)
    expect(world.reads).toEqual([])
  })

  it('never reads a path the address carries: only the id it names is looked up', async () => {
    const world = setup()
    const response = await world.handler(
      new Request(`${PICTURE_SCHEME}://${OTHER_ID}/../../../etc/passwd`),
    )
    expect(response.status).toBe(404)
    expect(world.lookups).toEqual([OTHER_ID])
    expect(world.reads).toEqual([])
  })

  it('finds nothing when the file has gone from disk', async () => {
    const world = setup({ isOnDisk: false })
    expect((await world.handler(new Request(pictureUrlFor(PICTURE_ID)))).status).toBe(404)
  })

  it('refuses anything but GET and HEAD', async () => {
    const world = setup()
    const response = await world.handler(
      new Request(pictureUrlFor(PICTURE_ID), { method: HTTP_METHODS.post }),
    )
    expect(response.status).toBe(405)
    expect(world.lookups).toEqual([])
  })
})
