import type { ExecutionContext } from '@nestjs/common'
import { isRecord } from '@raven/core'

/** The route parameters the guards and the controllers read, named once for the routes that declare them. */
export const ROUTE_PARAMS = {
  id: 'id',
  service: 'service',
  trackId: 'trackId',
  kind: 'kind',
  use: 'use',
  file: 'file',
} as const

/** A request's params and query, as far as a guard reads them. */
type RequestParts = { params: Record<string, unknown>; query: Record<string, unknown> }

/** The request a guard is asked about, as far as a guard reads it: its params and its query. */
export const requestParts = (context: ExecutionContext): RequestParts => {
  const request: unknown = context.switchToHttp().getRequest()
  const params = isRecord(request) && isRecord(request.params) ? request.params : {}
  const query = isRecord(request) && isRecord(request.query) ? request.query : {}
  return { params, query }
}
