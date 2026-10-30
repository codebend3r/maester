import { CONTENT_TYPES, HEADERS } from '@shared/server'
import type { MetadataFetch } from '@/metadata/tmdbClient'

/** The host LRCLIB answers on. */
export const LRCLIB_HOST = 'lrclib.net'

/** A record the fake keeps, found by its track's title. */
type FakeLyrics = { title: string; synced?: string; plain?: string; isInstrumental?: boolean }

type FakeLrclibProps = { records: readonly FakeLyrics[] }

/**
 * LRCLIB as a test's fetch: `/api/get` finds a record by its track name and
 * answers 404 for any other, or fails as a network does while `down`.
 * Every request is remembered with the query it asked and its User-Agent.
 */
export const fakeLrclib = ({ records }: FakeLrclibProps) => {
  const state = { isDown: false }
  const requests: { query: Record<string, string>; userAgent: string | null }[] = []
  const fetch: MetadataFetch = async ({ url, init }) => {
    const parsed = new URL(url)
    requests.push({
      query: Object.fromEntries(parsed.searchParams),
      userAgent: init.headers[HEADERS.userAgent] ?? null,
    })
    if (state.isDown) throw new TypeError('fetch failed')
    const record = records.find(({ title }) => title === parsed.searchParams.get('track_name'))
    const body =
      record === undefined
        ? { code: 404, name: 'TrackNotFound', message: 'Failed to find specified track' }
        : {
            id: 1,
            trackName: record.title,
            instrumental: record.isInstrumental ?? false,
            plainLyrics: record.plain ?? null,
            syncedLyrics: record.synced ?? null,
          }
    return new Response(JSON.stringify(body), {
      status: record === undefined ? 404 : 200,
      headers: { [HEADERS.contentType]: CONTENT_TYPES.json },
    })
  }
  type SetDownProps = { isDown: boolean }

  /** LRCLIB away, or back. */
  const setDown = ({ isDown }: SetDownProps): void => {
    state.isDown = isDown
  }
  return { fetch, requests, setDown }
}
