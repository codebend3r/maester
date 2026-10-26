import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib'
import { Body, Controller, Get, type MessageEvent, Module, Post, Res, Sse } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import type { FastifyReply } from 'fastify'
import { type Observable, Subject, map } from 'rxjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENCODINGS, compressResponses } from '@/compressResponses'
import { CACHE_POLICIES, CONTENT_TYPES, HEADERS, HTTP_METHODS } from '@/http'
import { serveWebApp } from '@/serveWebApp'

const LIST = Array.from({ length: 200 }, (_, id) => ({ id, title: `Video ${id}`, year: 2026 }))
const BLOB = Buffer.alloc(64 * 1024, 'raven ')
const VTT = [
  'WEBVTT',
  '',
  ...LIST.map(({ id }) => `00:00:${id % 60}.000 --> 00:00:${id % 60}.500\nLine ${id}\n`),
].join('\n')
const PAGE = `<!doctype html><title>app</title>${'<!-- padding -->'.repeat(100)}`
const SCRIPT = `console.log(${JSON.stringify(LIST)})`
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="1" height="1"/>'.repeat(100)}</svg>`
// A PNG's signature and then bytes that would compress well, so leaving them
// alone is the server's choice rather than zlib finding nothing to gain.
const POSTER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16 * 1024, 0),
])

const PLAYLIST = [
  '#EXTM3U',
  ...Array.from({ length: 200 }, (_, n) => `#EXTINF:6.000,\n/segment/${n}?t=ticket`),
  '#EXT-X-ENDLIST',
].join('\n')

const events = new Subject<string>()

@Controller('api')
class SampleController {
  @Get('list')
  list(): typeof LIST {
    return LIST
  }

  @Get('blob')
  async blob(@Res() reply: FastifyReply): Promise<void> {
    await reply
      .header(HEADERS.contentType, CONTENT_TYPES.octetStream)
      .header(HEADERS.contentLength, BLOB.length)
      .send(BLOB)
  }

  // As `reply.send(createReadStream(video))` would, with no type named.
  @Get('untyped')
  async untyped(@Res() reply: FastifyReply): Promise<void> {
    await reply.header(HEADERS.contentLength, BLOB.length).send(Readable.from([BLOB]))
  }

  @Get('subtitles')
  async subtitles(@Res() reply: FastifyReply): Promise<void> {
    await reply.header(HEADERS.contentType, CONTENT_TYPES.vtt).send(VTT)
  }

  @Get('playlist')
  async playlist(@Res() reply: FastifyReply): Promise<void> {
    await reply.header(HEADERS.contentType, CONTENT_TYPES.m3u8).send(PLAYLIST)
  }

  @Post('echo')
  echo(@Body() body: unknown): { body: unknown } {
    return { body }
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return events.pipe(map((data) => ({ data })))
  }
}

@Module({ controllers: [SampleController] })
class SampleModule {}

type DecodedProps = { headers: Record<string, unknown>; rawPayload: Buffer }

/** The body as a browser's fetch hands it over, unpacked from whatever it was sent in. */
const decoded = (response: DecodedProps): Buffer => {
  const encoding = response.headers[HEADERS.contentEncoding]
  if (encoding === ENCODINGS.br) return brotliDecompressSync(response.rawPayload)
  if (encoding === ENCODINGS.gzip) return gunzipSync(response.rawPayload)
  if (encoding === undefined) return response.rawPayload
  throw new Error(`Answered in ${String(encoding)}, which nobody asked for`)
}

/** What Chrome sends over https. */
const BROWSER = 'gzip, deflate, br, zstd'

describe('compressResponses', () => {
  const state: { dir: string; app: NestFastifyApplication | null } = { dir: '', app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('The app is not booted')
    return state.app
  }
  type GetProps = { url: string; headers?: Record<string, string> }

  const get = ({ url, headers = {} }: GetProps) =>
    app().inject({ method: HTTP_METHODS.get, url, headers })

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'shared-compress-'))
    await mkdir(join(state.dir, 'assets'), { recursive: true })
    await writeFile(join(state.dir, 'index.html'), PAGE)
    await writeFile(join(state.dir, 'assets', 'app-1a2b.js'), SCRIPT)
    await writeFile(join(state.dir, 'assets', 'logo-3c4d.svg'), LOGO)
    await writeFile(join(state.dir, 'assets', 'poster-5e6f.png'), POSTER)
    const created = await NestFactory.create<NestFastifyApplication>(
      SampleModule,
      new FastifyAdapter(),
      { logger: false },
    )
    await compressResponses({ app: created })
    await serveWebApp({ app: created, webDir: state.dir, serverPrefixes: ['/api/'] })
    await created.init()
    await created.getHttpAdapter().getInstance().ready()
    state.app = created
  })

  afterAll(async () => {
    events.complete()
    await state.app?.close()
    await rm(state.dir, { recursive: true, force: true })
  })

  it('compresses JSON with Brotli where the browser takes it, and gzip where it only takes gzip', async () => {
    const answers = await Promise.all(
      [BROWSER, 'br, gzip', 'gzip, deflate'].map((accept) =>
        get({ url: '/api/list', headers: { [HEADERS.acceptEncoding]: accept } }),
      ),
    )
    expect(answers.map((answer) => answer.headers[HEADERS.contentEncoding])).toEqual([
      ENCODINGS.br,
      ENCODINGS.br,
      ENCODINGS.gzip,
    ])
    answers.forEach((answer) => {
      expect(answer.headers[HEADERS.vary]).toContain(HEADERS.acceptEncoding)
      expect(answer.rawPayload.length).toBeLessThan(JSON.stringify(LIST).length / 4)
      expect(JSON.parse(decoded(answer).toString())).toEqual(LIST)
    })
  })

  it('answers a client that takes no compression as it always has', async () => {
    const answers = await Promise.all([
      get({ url: '/api/list' }),
      get({ url: '/api/list', headers: { [HEADERS.acceptEncoding]: 'identity' } }),
    ])
    answers.forEach((answer) => {
      expect(answer.headers[HEADERS.contentEncoding]).toBeUndefined()
      expect(answer.json()).toEqual(LIST)
    })
  })

  it("compresses the web app's page, script and SVG, cached as before", async () => {
    const files = [
      { url: '/', body: PAGE, cache: CACHE_POLICIES.noCache },
      { url: '/assets/app-1a2b.js', body: SCRIPT, cache: CACHE_POLICIES.immutable },
      { url: '/assets/logo-3c4d.svg', body: LOGO, cache: CACHE_POLICIES.immutable },
    ]
    const answers = await Promise.all(
      files.map(({ url }) => get({ url, headers: { [HEADERS.acceptEncoding]: BROWSER } })),
    )
    answers.forEach((answer, index) => {
      expect(answer.statusCode).toBe(200)
      expect(answer.headers[HEADERS.contentEncoding]).toBe(ENCODINGS.br)
      expect(answer.headers[HEADERS.cacheControl]).toBe(files[index]!.cache)
      expect(decoded(answer).toString()).toBe(files[index]!.body)
    })
  })

  it('compresses WebVTT subtitles', async () => {
    const answer = await get({
      url: '/api/subtitles',
      headers: { [HEADERS.acceptEncoding]: BROWSER },
    })
    expect(answer.headers[HEADERS.contentEncoding]).toBe(ENCODINGS.br)
    expect(decoded(answer).toString()).toBe(VTT)
  })

  it('compresses an HLS playlist', async () => {
    const answer = await get({
      url: '/api/playlist',
      headers: { [HEADERS.acceptEncoding]: BROWSER },
    })
    expect(answer.headers[HEADERS.contentEncoding]).toBe(ENCODINGS.br)
    expect(decoded(answer).toString()).toBe(PLAYLIST)
  })

  it('sends a picture as it is', async () => {
    const answer = await get({
      url: '/assets/poster-5e6f.png',
      headers: { [HEADERS.acceptEncoding]: BROWSER },
    })
    expect(answer.headers[HEADERS.contentEncoding]).toBeUndefined()
    expect(answer.headers[HEADERS.contentLength]).toBe(String(POSTER.length))
    expect(answer.rawPayload.equals(POSTER)).toBe(true)
  })

  it('sends binary as it is, its length included', async () => {
    const answer = await get({ url: '/api/blob', headers: { [HEADERS.acceptEncoding]: BROWSER } })
    expect(answer.headers[HEADERS.contentEncoding]).toBeUndefined()
    expect(answer.headers[HEADERS.contentLength]).toBe(String(BLOB.length))
    expect(answer.rawPayload.equals(BLOB)).toBe(true)
  })

  it('sends a stream that names no type as it is, its length included', async () => {
    const answer = await get({
      url: '/api/untyped',
      headers: { [HEADERS.acceptEncoding]: BROWSER },
    })
    expect(answer.headers[HEADERS.contentEncoding]).toBeUndefined()
    expect(answer.headers[HEADERS.contentLength]).toBe(String(BLOB.length))
    expect(answer.rawPayload.equals(BLOB)).toBe(true)
  })

  it('answers a Range request with the bytes asked for, uncompressed, whatever the route', async () => {
    const partial = await get({
      url: '/assets/app-1a2b.js',
      headers: { [HEADERS.acceptEncoding]: BROWSER, [HEADERS.range]: 'bytes=0-99' },
    })
    expect(partial.statusCode).toBe(206)
    expect(partial.headers[HEADERS.contentEncoding]).toBeUndefined()
    expect(partial.headers[HEADERS.contentRange]).toBe(`bytes 0-99/${Buffer.byteLength(SCRIPT)}`)
    expect(partial.body).toBe(SCRIPT.slice(0, 100))

    // A route that ignores the range still answers it as it always has.
    const whole = await get({
      url: '/api/list',
      headers: { [HEADERS.acceptEncoding]: BROWSER, [HEADERS.range]: 'bytes=0-99' },
    })
    expect(whole.statusCode).toBe(200)
    expect(whole.headers[HEADERS.contentEncoding]).toBeUndefined()
    expect(whole.json()).toEqual(LIST)
  })

  it('takes a request body as it is sent, never unpacking it', async () => {
    const answer = await app().inject({
      method: HTTP_METHODS.post,
      url: '/api/echo',
      headers: {
        [HEADERS.contentType]: CONTENT_TYPES.json,
        [HEADERS.contentEncoding]: ENCODINGS.gzip,
      },
      payload: gzipSync(JSON.stringify({ name: 'Films' })),
    })
    expect(answer.statusCode).toBe(400)
  })

  it('streams server-sent events uncompressed, each as it happens', async () => {
    const listening = await NestFactory.create<NestFastifyApplication>(
      SampleModule,
      new FastifyAdapter(),
      { logger: false },
    )
    await compressResponses({ app: listening })
    await listening.listen({ port: 0, host: '127.0.0.1' })
    const aborter = new AbortController()
    try {
      const response = await fetch(`${await listening.getUrl()}/api/events`, {
        headers: { [HEADERS.acceptEncoding]: BROWSER },
        signal: aborter.signal,
      })
      expect(response.headers.get(HEADERS.contentType)).toContain(CONTENT_TYPES.eventStream)
      expect(response.headers.get(HEADERS.contentEncoding)).toBeNull()
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No body to read')
      const decoder = new TextDecoder()
      type ReadUntilProps = { text: string; read: string }

      const readUntil = async ({ text, read }: ReadUntilProps): Promise<string> => {
        if (read.includes(text)) return read
        const chunk = await reader.read()
        if (chunk.done) throw new Error(`The stream ended before "${text}": ${read}`)
        return readUntil({ text, read: read + decoder.decode(chunk.value) })
      }
      events.next('first')
      // A compressed stream would hold the event back until it had more to
      // pack, and this read would never finish.
      const read = await Promise.race([
        readUntil({ text: 'data: first', read: '' }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('The event never arrived')), 2000),
        ),
      ])
      expect(read).toContain('data: first')
    } finally {
      aborter.abort()
      await listening.close()
    }
  })
})
