import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { NotFoundException } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { contentTypeOf } from '@/metadata/imageCache'

/**
 * Sends a cached picture. Versioned URLs (`?v=`) change whenever the picture
 * does, so they are cached for good, as thumbnails are.
 */
export const sendImage = async ({
  reply,
  path,
  version,
}: {
  reply: FastifyReply
  path: string | null
  version: string | undefined
}): Promise<void> => {
  const info = path == null ? null : await stat(path).catch(() => null)
  if (path == null || !info?.isFile()) throw new NotFoundException('No picture')
  await reply
    .header('content-type', contentTypeOf(path))
    .header('content-length', info.size)
    .header('cache-control', version ? 'public, max-age=31536000, immutable' : 'public, max-age=60')
    .send(createReadStream(path))
}
