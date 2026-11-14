import { BadRequestException } from '@nestjs/common'
import { HLS_PARAMS, HOME_SEARCH_PARAM, PING_BYTES_PARAM, isString } from '@raven/core'

/** The query keys the server reads that core names nowhere else, beside the ones it does. */
export const QUERY_PARAMS = {
  mode: HLS_PARAMS.mode,
  audio: HLS_PARAMS.audio,
  quality: HLS_PARAMS.quality,
  burn: HLS_PARAMS.burn,
  search: HOME_SEARCH_PARAM,
  bytes: PING_BYTES_PARAM,
  start: 'start',
  window: 'window',
  version: 'v',
  width: 'w',
  limit: 'limit',
  watched: 'watched',
  path: 'path',
  type: 'type',
  query: 'query',
  year: 'year',
  libraryId: 'libraryId',
  mediaId: 'mediaId',
  itemId: 'itemId',
} as const

/** What a query flag such as `?watched=true` says when it is on. */
export const QUERY_FLAGS = { true: 'true' } as const

type QueryTextProps = { value: unknown; name: string }

/** A query value given once, as text; undefined when absent, and a 400 when repeated or otherwise not text. */
export const queryText = ({ value, name }: QueryTextProps): string | undefined => {
  if (value === undefined || isString(value)) return value
  throw new BadRequestException(`${name} must be given once`)
}

type PageLimitProps = {
  asked: unknown
  /** How many a request gets unless it asks. */
  fallback: number
  /** The most it may ask for. */
  most: number
}

/** How many entries a page holds: what was asked for, from 1 up to `most`, or `fallback` when none was. */
export const pageLimit = ({ asked, fallback, most }: PageLimitProps): number => {
  const limit = isString(asked) ? Number.parseInt(asked, 10) : Number.NaN
  return Number.isInteger(limit) ? Math.min(Math.max(limit, 1), most) : fallback
}
