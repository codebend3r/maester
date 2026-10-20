import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { isRecord, isString } from '@raven/core'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

// Only parses a request's own path and query; nothing is ever fetched from it.
export const URL_BASE = 'http://fixture.invalid'

/** A request's path and query, split as the server reads them; one it cannot read names nothing. */
export const partsOf = (url: string): { pathname: string; query: URLSearchParams } => {
  if (!URL.canParse(url, URL_BASE)) return { pathname: '', query: new URLSearchParams() }
  const parsed = new URL(url, URL_BASE)
  return { pathname: parsed.pathname, query: parsed.searchParams }
}

export const tokenOf = () => `${Date.now()}.${randomBytes(18).toString('base64url')}`

const parseJson = (text: string | null): unknown => {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return null
  }
}

export const fieldOf = ({ body, name }: { body: string | null; name: string }): string | null => {
  const value = parseJson(body)
  if (!isRecord(value)) return null
  const field = value[name]
  return isString(field) ? field : null
}

export const sendJson = ({
  response,
  status,
  body,
  cookie = null,
}: {
  response: ServerResponse
  status: number
  body: unknown
  cookie?: string | null
}) => {
  response.writeHead(status, {
    [HTTP_HEADERS.contentType]: 'application/json; charset=utf-8',
    ...(cookie === null ? {} : { [HTTP_HEADERS.setCookie]: cookie }),
  })
  response.end(JSON.stringify(body))
}

export const sendEmpty = ({ response, status }: { response: ServerResponse; status: number }) => {
  response.writeHead(status)
  response.end()
}

export const sendMissing = (response: ServerResponse) =>
  sendJson({ response, status: 404, body: { message: 'Not found' } })
