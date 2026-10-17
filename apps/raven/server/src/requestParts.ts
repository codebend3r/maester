import type { ExecutionContext } from '@nestjs/common'
import { isRecord, isString } from '@raven/core'

/** The request a guard is asked about, as far as a guard reads it: its params, its query and its cookie. */
export const requestParts = (
  context: ExecutionContext,
): {
  params: Record<string, unknown>
  query: Record<string, unknown>
  cookie: string | undefined
} => {
  const request: unknown = context.switchToHttp().getRequest()
  const headers = isRecord(request) && isRecord(request.headers) ? request.headers : {}
  const params = isRecord(request) && isRecord(request.params) ? request.params : {}
  const query = isRecord(request) && isRecord(request.query) ? request.query : {}
  return { params, query, cookie: isString(headers.cookie) ? headers.cookie : undefined }
}
