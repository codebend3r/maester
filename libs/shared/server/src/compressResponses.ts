import { Stream } from 'node:stream'
import { constants } from 'node:zlib'
import fastifyCompress from '@fastify/compress'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'

// The plugin's own list adds octet-stream, which on a media server is a video.
// Anything else it takes from mime-db, which marks no video and neither JPEG
// nor PNG compressible.
const COMPRESSIBLE = /^text\/(?!event-stream)|[+/](?:json|xml)(?:;|$)/u

const isStream = (payload: unknown): payload is Stream | ReadableStream =>
  payload instanceof Stream || payload instanceof ReadableStream

/**
 * Compresses what compresses well, JSON and the web app's text, with Brotli
 * or gzip as the browser asks. Must run before the routes are registered:
 * the plugin hooks each route as it is added.
 *
 * The levels were measured on raven's own listings: Brotli 4 packs the 3 MB
 * Movies listing to 12% in 10 ms on a Mac, about 37 ms on the NAS, and level
 * 5 or more takes twice as long to take off another 1 to 2% of the original.
 * Browsers offer Brotli only over https, so plain http on the LAN gets gzip,
 * where the network is quick and level 1 costs the least CPU. Beyond the
 * plugin's `syncThreshold` (4 to 64 KB by core count) zlib runs on libuv's
 * threadpool, off the event loop.
 */
export const compressResponses = async ({
  app,
}: {
  app: NestFastifyApplication
}): Promise<void> => {
  const fastify = app.getHttpAdapter().getInstance()
  // A Range asks for bytes of the uncompressed file, so it is answered as it
  // always was. `x-no-compression` is the plugin's way to skip one request.
  fastify.addHook('onRequest', async (request) => {
    if (request.headers.range !== undefined) {
      request.headers = { ...request.headers, 'x-no-compression': 'range' }
    }
  })
  // The plugin compresses a reply with no type as JSON, and Fastify names no
  // type for a stream, so a stream that names none would be packed and lose
  // its length. Called bytes, it goes out as it is. Fastify runs this hook
  // before the plugin's, which it adds to each route.
  fastify.addHook('onSend', async (_request, reply, payload) => {
    if (reply.getHeader('content-type') === undefined && isStream(payload)) {
      reply.header('content-type', 'application/octet-stream')
    }
    return payload
  })
  await app.register(fastifyCompress, {
    encodings: ['br', 'gzip'],
    customTypes: COMPRESSIBLE,
    brotliOptions: { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } },
    zlibOptions: { level: 1 },
    // Responses only: a request body is read exactly as it was sent.
    globalDecompression: false,
  })
}
