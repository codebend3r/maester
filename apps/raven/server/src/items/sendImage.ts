import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { NotFoundException } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { contentTypeOf } from '@/metadata/imageCache'

/**
 * Sends a cached picture. Versioned URLs (`?v=`) change whenever the picture
 * does, so they are cached for good, as thumbnails are. Only by the browser,
 * though: a shared cache in front of raven, such as Netlify's proxy, must not
 * keep a picture the PIN lock gave one browser and hand it to the next.
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
    .header(
      'cache-control',
      version ? 'private, max-age=31536000, immutable' : 'private, max-age=60',
    )
    .send(createReadStream(path))
}
