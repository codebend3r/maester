import { extensionOf, HTTP_METHODS } from '@raven/core'
import { ALLOWED_METHODS } from '@/main/webHost'
import type { Grants } from '@/main/grants'
import { HEADERS, HTTP_STATUSES } from '@shared/http'

const BYTE_RANGE_KINDS = {
  all: 'all',
  range: 'range',
  unsatisfiable: 'unsatisfiable',
} as const

export type ByteRange =
  | { kind: typeof BYTE_RANGE_KINDS.all }
  | { kind: typeof BYTE_RANGE_KINDS.range; start: number; end: number }
  | { kind: typeof BYTE_RANGE_KINDS.unsatisfiable }

const ALL: ByteRange = { kind: BYTE_RANGE_KINDS.all }
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

type ParseRangeProps = {
  header: string | null
  size: number
}

/** One byte range and nothing else: anything malformed or multi-range is served whole. */
export const parseRange = ({ header, size }: ParseRangeProps): ByteRange => {
  if (header === null) return ALL
  const match = SINGLE_RANGE.exec(header)
  if (match === null) return ALL
  const [, first = '', last = ''] = match

  if (first === '') {
    if (last === '') return ALL
    const length = Number(last)
    if (length === 0 || size === 0) return { kind: BYTE_RANGE_KINDS.unsatisfiable }
    return { kind: BYTE_RANGE_KINDS.range, start: Math.max(0, size - length), end: size - 1 }
  }

  const start = Number(first)
  if (last !== '' && Number(last) < start) return ALL
  if (start >= size) return { kind: BYTE_RANGE_KINDS.unsatisfiable }
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
  return { kind: BYTE_RANGE_KINDS.range, start, end }
}

const CONTENT_TYPES = new Map(
  Object.entries({
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    ogv: 'video/ogg',
    ts: 'video/mp2t',
    m2ts: 'video/mp2t',
    mts: 'video/mp2t',
    avi: 'video/x-msvideo',
  }),
)

export const contentTypeFor = (fileName: string): string =>
  CONTENT_TYPES.get(extensionOf(fileName)) ?? 'application/octet-stream'

type AnswerProps = {
  status: number
  body?: ReadableStream<Uint8Array> | null
  headers?: Record<string, string>
}

const answer = ({ status, body = null, headers = {} }: AnswerProps): Response =>
  new Response(body, {
    status,
    headers: { ...headers, [HEADERS.contentTypeOptions]: 'nosniff' },
  })

/** The host a custom scheme's address names, which is the opaque id it asks for. */
export const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

type ReadRangeProps = { path: string; start: number; end: number }

type CreateFileHandlerProps = {
  grants: Pick<Grants, 'fileOf'>
  stat: (path: string) => Promise<{ size: number } | null>
  readRange: (input: ReadRangeProps) => ReadableStream<Uint8Array>
}

export const createFileHandler = ({
  grants,
  stat,
  readRange,
}: CreateFileHandlerProps): ((request: Request) => Promise<Response>) => {
  return async (request) => {
    if (request.method !== HTTP_METHODS.get && request.method !== HTTP_METHODS.head) {
      return answer({
        status: HTTP_STATUSES.methodNotAllowed,
        headers: { [HEADERS.allow]: ALLOWED_METHODS },
      })
    }
    const host = hostOf(request.url)
    const file = host === null ? null : grants.fileOf(host)
    if (file === null) return answer({ status: HTTP_STATUSES.notFound })
    // The file may have changed since the grant, so its size is read for each request.
    const stats = await stat(file.path).catch(() => null)
    if (stats === null) return answer({ status: HTTP_STATUSES.notFound })

    const { size } = stats
    const isHead = request.method === HTTP_METHODS.head
    const common = {
      [HEADERS.acceptRanges]: 'bytes',
      [HEADERS.contentType]: contentTypeFor(file.name),
      [HEADERS.cacheControl]: 'no-store',
    }

    if (size === 0) {
      return answer({
        status: HTTP_STATUSES.ok,
        headers: { ...common, [HEADERS.contentLength]: '0' },
      })
    }

    const range = parseRange({ header: request.headers.get(HEADERS.range), size })
    if (range.kind === BYTE_RANGE_KINDS.unsatisfiable) {
      return answer({
        status: HTTP_STATUSES.rangeNotSatisfiable,
        headers: {
          ...common,
          [HEADERS.contentLength]: '0',
          [HEADERS.contentRange]: `bytes */${size}`,
        },
      })
    }

    const { start, end } =
      range.kind === BYTE_RANGE_KINDS.range ? range : { start: 0, end: size - 1 }
    const headers = {
      ...common,
      [HEADERS.contentLength]: `${end - start + 1}`,
      ...(range.kind === BYTE_RANGE_KINDS.range && {
        [HEADERS.contentRange]: `bytes ${start}-${end}/${size}`,
      }),
    }
    const status =
      range.kind === BYTE_RANGE_KINDS.range ? HTTP_STATUSES.partialContent : HTTP_STATUSES.ok
    if (isHead) return answer({ status, headers })
    try {
      return answer({ status, headers, body: readRange({ path: file.path, start, end }) })
    } catch {
      return answer({ status: HTTP_STATUSES.internalServerError })
    }
  }
}
