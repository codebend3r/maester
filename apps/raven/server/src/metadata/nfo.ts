import { readFile, stat } from 'node:fs/promises'
import type { NameIds } from '@raven/core'

/** Radarr's and Sonarr's NFOs are a few KB; anything far bigger is not one. */
const MAX_BYTES = 1024 * 1024

const ROOTS = /<(movie|tvshow|episodedetails)[\s>]/i

const firstMatch = ({
  xml,
  patterns,
}: {
  xml: string
  patterns: readonly RegExp[]
}): string | null =>
  patterns.map((pattern) => pattern.exec(xml)?.[1]?.trim() ?? '').find((value) => value !== '') ??
  null

const uniqueId = (type: string): RegExp =>
  new RegExp(`<uniqueid[^>]*type=["']${type}["'][^>]*>\\s*([^<\\s]+)\\s*</uniqueid>`, 'i')

/**
 * The ids in an NFO's text: `<uniqueid type="...">`, then `<tmdbid>`,
 * `<imdbid>` and `<tvdbid>`. Only ids are read, never the rest. Null when
 * the text is not an NFO at all.
 */
export const parseNfoIds = (xml: string): NameIds | null => {
  if (!ROOTS.test(xml)) return null
  const ids: NameIds = {
    tmdb: firstMatch({ xml, patterns: [uniqueId('tmdb'), /<tmdbid>\s*(\d+)\s*<\/tmdbid>/i] }),
    imdb: firstMatch({
      xml,
      patterns: [uniqueId('imdb'), /<imdbid>\s*(tt\d+)\s*<\/imdbid>/i, /<id>\s*(tt\d+)\s*<\/id>/i],
    }),
    tvdb: firstMatch({ xml, patterns: [uniqueId('tvdb'), /<tvdbid>\s*(\d+)\s*<\/tvdbid>/i] }),
  }
  return (ids.tmdb ?? ids.imdb ?? ids.tvdb) ? ids : null
}

/** An NFO's ids, or null when it is missing, too big, or not an NFO. */
export const readNfoIds = async (path: string): Promise<NameIds | null> => {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size > MAX_BYTES) return null
  const xml = await readFile(path, 'utf8').catch(() => '')
  return parseNfoIds(xml)
}
