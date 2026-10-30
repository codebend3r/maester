import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { NotFoundException } from '@nestjs/common'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyReply } from 'fastify'
import { RAVEN_CACHE_POLICIES } from '@/http'
import { contentTypeOf } from '@/metadata/imageCache'

/** Who may keep a picture: only the browser that asked, or any cache on the way. */
export const IMAGE_AUDIENCES = { browser: 'browser', everyone: 'everyone' } as const

type ImageAudience = (typeof IMAGE_AUDIENCES)[keyof typeof IMAGE_AUDIENCES]

type SendImageProps = {
  reply: FastifyReply
  path: string | null
  version: string | undefined
  audience?: ImageAudience
}

/**
 * Sends a cached picture or thumbnail. Versioned URLs (`?v=`) change whenever
 * the picture does, so they are cached for good. Only by the browser,
 * though, unless `audience` says everyone: a shared cache in front of raven,
 * such as Netlify's proxy, must not keep a picture the PIN lock gave one
 * browser and hand it to the next. A picture whose address is its own
 * capability (`/api/pictures`) is the same for everyone who holds it, so
 * any cache may keep that one.
 */
export const sendImage = async ({
  reply,
  path,
  version,
  audience = IMAGE_AUDIENCES.browser,
}: SendImageProps): Promise<void> => {
  const info = path == null ? null : await stat(path).catch(() => null)
  if (path == null || !info?.isFile()) throw new NotFoundException('No picture')
  const privatePolicy = version
    ? RAVEN_CACHE_POLICIES.privateImmutable
    : RAVEN_CACHE_POLICIES.privateMinute
  const policy = audience === IMAGE_AUDIENCES.everyone ? CACHE_POLICIES.immutable : privatePolicy
  await reply
    .header(HEADERS.contentType, contentTypeOf(path))
    .header(HEADERS.contentLength, info.size)
    .header(HEADERS.cacheControl, policy)
    .send(createReadStream(path))
}
