import { afterEach, beforeEach, expect, it, jest } from '@jest/globals'
import { HTTP_METHODS } from '@raven/core'
import { File } from 'expo-file-system'

import type * as Downloader from '@/downloads/downloader'

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents/' },
  Directory: jest.fn(),
  File: class {
    static downloadFileAsync = jest.fn<() => Promise<void>>(async () => undefined)
    parentDirectory = { create: jest.fn() }
    exists = false
    size = 123
    delete = jest.fn()
    moveSync = jest.fn()
  },
}))

const { deviceDisk } = jest.requireActual<typeof Downloader>('@/downloads/downloader')
const SOURCE = {
  uri: 'http://127.0.0.1:8490/api/media/4/transcode?kbps=256',
  headers: { Cookie: 'raven_unlock=fixture' },
} as const
const PATH = 'downloads/server/4/media.m4a'

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
})

afterEach(() => {
  jest.restoreAllMocks()
})

it('waits for server preparation before starting the native download', async () => {
  let release: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  jest.mocked(fetch).mockImplementation(async () => {
    await ready
    return new Response(null, { status: 200 })
  })

  const downloading = deviceDisk.fetch({ source: SOURCE, path: PATH })

  expect(fetch).toHaveBeenCalledWith(SOURCE.uri, {
    method: HTTP_METHODS.head,
    credentials: 'omit',
    headers: SOURCE.headers,
  })
  expect(File.downloadFileAsync).not.toHaveBeenCalled()
  release()
  await expect(downloading).resolves.toBe(123)
  expect(File.downloadFileAsync).toHaveBeenCalledWith(SOURCE.uri, expect.any(File), {
    headers: SOURCE.headers,
    idempotent: true,
  })
})

it('does not download an error response', async () => {
  jest.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }))

  await expect(deviceDisk.fetch({ source: SOURCE, path: PATH })).rejects.toThrow(
    'Could not prepare download (403)',
  )
  expect(File.downloadFileAsync).not.toHaveBeenCalled()
})

it('preserves preparation failures without starting a native download', async () => {
  jest.mocked(fetch).mockRejectedValue(new Error('Server unreachable'))

  await expect(deviceDisk.fetch({ source: SOURCE, path: PATH })).rejects.toThrow(
    'Server unreachable',
  )
  expect(File.downloadFileAsync).not.toHaveBeenCalled()
})
