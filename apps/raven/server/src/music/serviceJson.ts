import { isRecord, isString } from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import type { MetadataFetch } from '@/metadata/tmdbClient'
import { RAVEN_USER_AGENT } from '@/music/userAgent'

/** One call may take this long before the service counts as away. */
const TIMEOUT_MS = 10_000

/** What every music service is asked with: JSON, and the `User-Agent` each asks a client to name itself by. */
const SERVICE_HEADERS = {
  [HEADERS.accept]: CONTENT_TYPES.json,
  [HEADERS.userAgent]: RAVEN_USER_AGENT,
} as const

type ServiceRequestProps = { fetch: MetadataFetch; url: string }

/** A music service's answer at `url`, asked with `SERVICE_HEADERS` and given ten seconds. */
export const serviceRequest = ({ fetch, url }: ServiceRequestProps): Promise<Response> =>
  fetch({ url, init: { headers: SERVICE_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) } })

/**
 * A music service's JSON answer at `url`, asked as `serviceRequest` asks; null for an answer
 * that is not ok. A service that does not answer at all rejects.
 */
export const serviceJson = async (props: ServiceRequestProps): Promise<unknown> => {
  const response = await serviceRequest(props)
  return response.ok ? response.json() : null
}

type AtProps = { record: Record<string, unknown>; key: string }

/** The list under `key`, or none: the services leave a field out as often as they send an empty list. */
export const listAt = ({ record, key }: AtProps): unknown[] => {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

/** The record under `key`, or an empty one. */
export const recordAt = ({ record, key }: AtProps): Record<string, unknown> => {
  const value = record[key]
  return isRecord(value) ? value : {}
}

/** A string with something in it, as it was sent; null for anything else. */
export const textAt = (value: unknown): string | null =>
  isString(value) && value.trim() !== '' ? value : null
