import { extensionOf } from '@raven/core'
import type { Grants } from '@/main/grants'

export type ByteRange =
  | { kind: 'all' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' }

const ALL: ByteRange = { kind: 'all' }
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

/** One byte range and nothing else: anything malformed or multi-range is served whole. */
export const parseRange = ({
  header,
  size,
}: {
  header: string | null
  size: number
}): ByteRange => {
  if (header === null) return ALL
  const match = SINGLE_RANGE.exec(header)
  if (match === null) return ALL
  const [, first = '', last = ''] = match

  if (first === '') {
    if (last === '') return ALL
    const length = Number(last)
    if (length === 0 || size === 0) return { kind: 'unsatisfiable' }
    return { kind: 'range', start: Math.max(0, size - length), end: size - 1 }
  }

  const start = Number(first)
  if (last !== '' && Number(last) < start) return ALL
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
  return { kind: 'range', start, end }
}

const CONTENT_TYPES: Record<string, string> = {
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
}

export const contentTypeFor = (fileName: string): string =>
  CONTENT_TYPES[extensionOf(fileName)] ?? 'application/octet-stream'

const answer = ({
  status,
  body = null,
  headers = {},
}: {
  status: number
  body?: ReadableStream<Uint8Array> | null
  headers?: Record<string, string>
}): Response => new Response(body, { status, headers })

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export const createFileHandler = ({
  grants,
  stat,
  readRange,
}: {
  grants: Pick<Grants, 'fileOf'>
  stat: (path: string) => Promise<{ size: number } | null>
  readRange: (input: { path: string; start: number; end: number }) => ReadableStream<Uint8Array>
}): ((request: Request) => Promise<Response>) => {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return answer({ status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    const host = hostOf(request.url)
    const file = host === null ? null : grants.fileOf(host)
    if (file === null) return answer({ status: 404 })
    // The file may have changed since the grant, so its size is read for each request.
    const stats = await stat(file.path).catch(() => null)
    if (stats === null) return answer({ status: 404 })

    const { size } = stats
    const isHead = request.method === 'HEAD'
    const common = {
      'Accept-Ranges': 'bytes',
      'Content-Type': contentTypeFor(file.name),
      'Cache-Control': 'no-store',
    }

    if (size === 0) {
      return answer({ status: 200, headers: { ...common, 'Content-Length': '0' } })
    }

    const range = parseRange({ header: request.headers.get('Range'), size })
    if (range.kind === 'unsatisfiable') {
      return answer({ status: 416, headers: { ...common, 'Content-Range': `bytes */${size}` } })
    }

    const { start, end } = range.kind === 'range' ? range : { start: 0, end: size - 1 }
    const headers = {
      ...common,
      'Content-Length': `${end - start + 1}`,
      ...(range.kind === 'range' && { 'Content-Range': `bytes ${start}-${end}/${size}` }),
    }
    return answer({
      status: range.kind === 'range' ? 206 : 200,
      headers,
      body: isHead ? null : readRange({ path: file.path, start, end }),
    })
  }
}
