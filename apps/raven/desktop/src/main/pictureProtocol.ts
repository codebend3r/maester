import { HTTP_METHODS } from '@raven/core'
import type { DownloadPictures } from '@/main/downloads/pictures'
import { hostOf } from '@/main/fileProtocol'
import { ALLOWED_METHODS } from '@/main/webHost'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

type AnswerProps = {
  status: number
  body?: Uint8Array | null
  headers?: Record<string, string>
}

const answer = ({ status, body = null, headers = {} }: AnswerProps): Response =>
  new Response(body, {
    status,
    headers: { ...headers, [HTTP_HEADERS.contentTypeOptions]: 'nosniff' },
  })

type PictureHandler = (request: Request) => Promise<Response>

type CreatePictureHandlerProps = {
  pictures: Pick<DownloadPictures, 'fileOf'>
  readFile: (path: string) => Promise<Uint8Array>
}

/**
 * Answers `raven-picture://<picture id>` with a download's saved picture, whole: the id is one
 * main gave the picture when it saved it, so the page names no path, and an id no download holds
 * finds nothing.
 */
export const createPictureHandler = ({
  pictures,
  readFile,
}: CreatePictureHandlerProps): PictureHandler => {
  return async (request) => {
    if (request.method !== HTTP_METHODS.get && request.method !== HTTP_METHODS.head) {
      return answer({
        status: HTTP_STATUSES.methodNotAllowed,
        headers: { [HTTP_HEADERS.allow]: ALLOWED_METHODS },
      })
    }
    const host = hostOf(request.url)
    const file = host === null ? null : pictures.fileOf(host)
    if (file === null) return answer({ status: HTTP_STATUSES.notFound })
    const bytes = await readFile(file.path).catch(() => null)
    if (bytes === null) return answer({ status: HTTP_STATUSES.notFound })
    const headers = {
      [HTTP_HEADERS.contentType]: file.contentType,
      [HTTP_HEADERS.contentLength]: `${bytes.length}`,
      // A picture's id names one file for good, so the page never needs to ask twice.
      [HTTP_HEADERS.cacheControl]: 'private, max-age=31536000, immutable',
    }
    return answer({
      status: HTTP_STATUSES.ok,
      headers,
      body: request.method === HTTP_METHODS.head ? null : bytes,
    })
  }
}
