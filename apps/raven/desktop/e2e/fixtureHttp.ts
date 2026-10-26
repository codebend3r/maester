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

type FieldOfProps = { body: string | null; name: string }

export const fieldOf = ({ body, name }: FieldOfProps): string | null => {
  const value = parseJson(body)
  if (!isRecord(value)) return null
  const field = value[name]
  return isString(field) ? field : null
}

/** The CORS headers the stand-in Auth answers the page's cross-origin calls with, as Supabase does. */
const CORS_HEADERS = {
  allowOrigin: 'access-control-allow-origin',
  allowMethods: 'access-control-allow-methods',
  allowHeaders: 'access-control-allow-headers',
} as const

/** The preflight a browser sends before a cross-origin call with headers of its own. */
export const PREFLIGHT_METHOD = 'OPTIONS'

type AllowCrossOriginProps = {
  response: ServerResponse
  origin: string
}

/** Lets `origin` call what `response` answers, with the headers supabase-js sends. */
export const allowCrossOrigin = ({ response, origin }: AllowCrossOriginProps): void => {
  response.setHeader(CORS_HEADERS.allowOrigin, origin)
  response.setHeader(CORS_HEADERS.allowMethods, 'GET, POST, PUT, DELETE, OPTIONS')
  response.setHeader(
    CORS_HEADERS.allowHeaders,
    'apikey, authorization, content-type, x-client-info, x-supabase-api-version',
  )
}

type SendJsonProps = {
  response: ServerResponse
  status: number
  body: unknown
  cookie?: string | null
}

export const sendJson = ({ response, status, body, cookie = null }: SendJsonProps) => {
  response.writeHead(status, {
    [HTTP_HEADERS.contentType]: 'application/json; charset=utf-8',
    ...(cookie === null ? {} : { [HTTP_HEADERS.setCookie]: cookie }),
  })
  response.end(JSON.stringify(body))
}

type SendEmptyProps = { response: ServerResponse; status: number }

export const sendEmpty = ({ response, status }: SendEmptyProps) => {
  response.writeHead(status)
  response.end()
}

export const sendMissing = (response: ServerResponse) =>
  sendJson({ response, status: 404, body: { message: 'Not found' } })
