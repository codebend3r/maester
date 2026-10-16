import { describe, expect, it } from 'bun:test'
import { contentTypeFor, createFileHandler, parseRange } from '@/main/fileProtocol'
import type { GrantedFile } from '@/main/grants'

describe('parseRange', () => {
  const parse = (header: string | null, size = 1000) => parseRange({ header, size })

  it('treats no header as all', () => {
    expect(parse(null)).toEqual({ kind: 'all' })
  })

  it('reads an open end', () => {
    expect(parse('bytes=0-')).toEqual({ kind: 'range', start: 0, end: 999 })
    expect(parse('bytes=500-')).toEqual({ kind: 'range', start: 500, end: 999 })
  })

  it('reads a closed range and clamps its end', () => {
    expect(parse('bytes=100-199')).toEqual({ kind: 'range', start: 100, end: 199 })
    expect(parse('bytes=900-5000')).toEqual({ kind: 'range', start: 900, end: 999 })
    expect(parse('bytes=0-0')).toEqual({ kind: 'range', start: 0, end: 0 })
    expect(parse('bytes=999-999')).toEqual({ kind: 'range', start: 999, end: 999 })
  })

  it('reads a suffix range', () => {
    expect(parse('bytes=-500')).toEqual({ kind: 'range', start: 500, end: 999 })
    expect(parse('bytes=-1')).toEqual({ kind: 'range', start: 999, end: 999 })
    expect(parse('bytes=-1000')).toEqual({ kind: 'range', start: 0, end: 999 })
    expect(parse('bytes=-5000')).toEqual({ kind: 'range', start: 0, end: 999 })
  })

  it('is unsatisfiable when the start is past the end', () => {
    expect(parse('bytes=1000-')).toEqual({ kind: 'unsatisfiable' })
    expect(parse('bytes=1000-1500')).toEqual({ kind: 'unsatisfiable' })
    expect(parse('bytes=99999999999999999999-')).toEqual({ kind: 'unsatisfiable' })
    expect(parse('bytes=-0')).toEqual({ kind: 'unsatisfiable' })
    expect(parse('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('falls back to all for multiple ranges', () => {
    expect(parse('bytes=0-1,5-6')).toEqual({ kind: 'all' })
    expect(parse('bytes=0-1, 5-6')).toEqual({ kind: 'all' })
    expect(parse('bytes=0-,-5')).toEqual({ kind: 'all' })
  })

  it.each([
    'items=0-1',
    'bytes=abc',
    'bytes=',
    'bytes=-',
    'bytes=1-2-3',
    'bytes=a-b',
    'bytes=-a',
    'bytes=1.5-2',
    'bytes=+1-2',
    'bytes=0x10-0x20',
    'bytes=200-100',
    'bytes 0-1',
    'bytes0-1',
    '0-1',
    '',
    'bytes=0-1;x',
    'BYTES=0-1',
  ])('falls back to all for %p', (header) => {
    expect(parse(header)).toEqual({ kind: 'all' })
  })
})

describe('contentTypeFor', () => {
  it.each([
    ['Film.mp4', 'video/mp4'],
    ['Film.m4v', 'video/mp4'],
    ['Film.webm', 'video/webm'],
    ['Film.MKV', 'video/x-matroska'],
    ['Film.mov', 'video/quicktime'],
    ['Film.ogv', 'video/ogg'],
    ['Film.ts', 'video/mp2t'],
    ['Film.m2ts', 'video/mp2t'],
    ['Film.mts', 'video/mp2t'],
    ['Film.avi', 'video/x-msvideo'],
    ['Film.wmv', 'application/octet-stream'],
    ['Film', 'application/octet-stream'],
  ])('%s is %s', (name, type) => {
    expect(contentTypeFor(name)).toBe(type)
  })
})

const ID = '3f2b8c1e-5a4d-4e7b-9c2a-1d6e8f0a4b3c'

const granted = (overrides: Partial<GrantedFile> = {}): GrantedFile => ({
  fileId: ID,
  path: '/movies/Film.mkv',
  name: 'Film.mkv',
  size: 1000,
  mtimeMs: 1,
  ...overrides,
})

type RangeCall = { path: string; start: number; end: number }

const setup = ({
  file = granted(),
  size = 1000 as number | null,
}: { file?: GrantedFile | null; size?: number | null } = {}) => {
  const rangeCalls: RangeCall[] = []
  const statCalls: string[] = []
  const lookups: string[] = []
  const state = { size }
  const handler = createFileHandler({
    grants: {
      fileOf: (fileId) => {
        lookups.push(fileId)
        return file !== null && fileId === file.fileId ? file : null
      },
    },
    stat: async (path) => {
      statCalls.push(path)
      return state.size === null ? null : { size: state.size }
    },
    readRange: (input) => {
      rangeCalls.push(input)
      const length = input.end - input.start + 1
      return new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new Uint8Array(length).fill(7))
          controller.close()
        },
      })
    },
  })
  return { handler, rangeCalls, statCalls, lookups, state }
}

const get = ({
  url = `raven-file://${ID}`,
  range,
  method = 'GET',
}: {
  url?: string
  range?: string
  method?: string
}) => new Request(url, { method, headers: range === undefined ? {} : { Range: range } })

describe('file handler ranges', () => {
  it('serves the whole file without a Range header', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({}))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('1000')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Content-Type')).toBe('video/x-matroska')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Range')).toBeNull()
    expect((await response.arrayBuffer()).byteLength).toBe(1000)
    expect(rangeCalls).toEqual([{ path: '/movies/Film.mkv', start: 0, end: 999 }])
  })

  it('answers an open range with 206', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({ range: 'bytes=0-' }))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 0-999/1000')
    expect(response.headers.get('Content-Length')).toBe('1000')
    expect(rangeCalls).toEqual([{ path: '/movies/Film.mkv', start: 0, end: 999 }])
  })

  it('answers a closed range', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({ range: 'bytes=100-199' }))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 100-199/1000')
    expect(response.headers.get('Content-Length')).toBe('100')
    expect((await response.arrayBuffer()).byteLength).toBe(100)
    expect(rangeCalls).toEqual([{ path: '/movies/Film.mkv', start: 100, end: 199 }])
  })

  it('clamps an end past the file', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({ range: 'bytes=900-5000' }))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 900-999/1000')
    expect(rangeCalls[0]).toEqual({ path: '/movies/Film.mkv', start: 900, end: 999 })
  })

  it('answers a suffix range', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({ range: 'bytes=-100' }))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 900-999/1000')
    expect(response.headers.get('Content-Length')).toBe('100')
    expect(rangeCalls[0]).toEqual({ path: '/movies/Film.mkv', start: 900, end: 999 })
  })

  it('answers 416 for a start past the end, reading nothing', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({ range: 'bytes=1000-' }))
    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe('bytes */1000')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(rangeCalls).toEqual([])
  })

  it('serves a multi-range or malformed header as the whole file', async () => {
    const { handler, rangeCalls } = setup()
    const multi = await handler(get({ range: 'bytes=0-1,5-6' }))
    expect(multi.status).toBe(200)
    expect(multi.headers.get('Content-Length')).toBe('1000')
    const bad = await handler(get({ range: 'bytes=abc' }))
    expect(bad.status).toBe(200)
    expect(rangeCalls).toEqual([
      { path: '/movies/Film.mkv', start: 0, end: 999 },
      { path: '/movies/Film.mkv', start: 0, end: 999 },
    ])
  })

  it('answers a 0-byte file with 200 and an empty body, even for a range', async () => {
    const { handler, rangeCalls } = setup({ size: 0 })
    const plain = await handler(get({}))
    expect(plain.status).toBe(200)
    expect(plain.headers.get('Content-Length')).toBe('0')
    expect(await plain.text()).toBe('')
    const ranged = await handler(get({ range: 'bytes=0-' }))
    expect(ranged.status).toBe(200)
    expect(await ranged.text()).toBe('')
    expect(rangeCalls).toEqual([])
  })

  it('uses the size stat reports now, not the size at grant time', async () => {
    const { handler, rangeCalls } = setup({ size: 500 })
    const response = await handler(get({ range: 'bytes=0-' }))
    expect(response.headers.get('Content-Range')).toBe('bytes 0-499/500')
    expect(rangeCalls[0]).toEqual({ path: '/movies/Film.mkv', start: 0, end: 499 })
  })

  it('stats on every request', async () => {
    const { handler, statCalls } = setup()
    await handler(get({}))
    await handler(get({ range: 'bytes=0-9' }))
    expect(statCalls).toEqual(['/movies/Film.mkv', '/movies/Film.mkv'])
  })
})

describe('file handler refusals', () => {
  it('404s an unknown id without touching the file system', async () => {
    const { handler, statCalls, rangeCalls } = setup()
    const response = await handler(
      get({ url: 'raven-file://11111111-1111-4111-8111-111111111111' }),
    )
    expect(response.status).toBe(404)
    expect(statCalls).toEqual([])
    expect(rangeCalls).toEqual([])
  })

  it.each([
    'raven-file://etc',
    'raven-file://..',
    'raven-file://%2e%2e',
    'raven-file://%2fetc%2fpasswd',
    'raven-file://localhost/etc/passwd',
    'raven-file:///etc/passwd',
    'raven-file://users',
    'raven-file://c:',
  ])('404s an id that looks like a path: %s', async (url) => {
    const { handler, statCalls, rangeCalls } = setup()
    const response = await handler(get({ url }))
    expect(response.status).toBe(404)
    expect(statCalls).toEqual([])
    expect(rangeCalls).toEqual([])
  })

  it('ignores any path after the id and never uses it to pick a file', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({ url: `raven-file://${ID}/..%2f..%2fetc%2fpasswd` }))
    expect(response.status).toBe(200)
    expect(rangeCalls[0]?.path).toBe('/movies/Film.mkv')
  })

  it('404s a granted file that stat can no longer find', async () => {
    const { handler, rangeCalls } = setup({ size: null })
    const response = await handler(get({}))
    expect(response.status).toBe(404)
    expect(rangeCalls).toEqual([])
  })

  it('answers HEAD with the headers and an empty body', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({ method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('1000')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(await response.text()).toBe('')
    expect(rangeCalls).toEqual([])
  })

  it('answers HEAD with a range as 206 headers and no body', async () => {
    const { handler, rangeCalls } = setup()
    const response = await handler(get({ method: 'HEAD', range: 'bytes=0-9' }))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(await response.text()).toBe('')
    expect(rangeCalls).toEqual([])
  })

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('405s %s', async (method) => {
    const { handler, statCalls } = setup()
    const response = await handler(new Request(`raven-file://${ID}`, { method }))
    expect(response.status).toBe(405)
    expect(statCalls).toEqual([])
  })
})
