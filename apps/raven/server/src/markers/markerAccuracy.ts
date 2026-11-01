/**
 * Scores marker detection against the spike's hand labels, on the real
 * files: `bun run markers:accuracy <labels.json> <media root> [cache.json]`.
 * Each show of the fixture is one season; its episodes are fingerprinted,
 * matched and placed exactly as `MarkerDetection` does. An intro counts
 * when both ends land within 2 s of the label; an end theme is checked
 * against a credits chapter where the file names one; a film's crawl
 * counts within 10 s of the label, and one that starts early is the
 * failure that matters. It needs the media, so it runs where the libraries
 * are (Vhagar), never in `verify`; its last result goes in the PR that
 * changes a detector. A cache file keeps the fingerprints between runs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PLAYBACK_SETTINGS,
  type Infer,
  MARKER_KINDS,
  type Marker,
  type MarkerKind,
  isNumber,
  isRecord,
  isString,
  listOf,
  nullable,
  object,
} from '@raven/core'
import { readServerConfig } from '@/config'
import { chapterMarkers, parseChapters } from '@/ffmpeg/chapters'
import { ScanControl } from '@/scanner/scanControl'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { detectFilmCredits } from '@/markers/creditsDetector'
import type { KeptFingerprint } from '@/markers/fingerprintMatch'
import { strongest } from '@/markers/markerRows'
import { REGIONS, type Region } from '@/markers/seasonListen'
import { detectSeasonMarkers } from '@/markers/seasonMarkers'

/** An intro's ends, or an end theme's start, within this many seconds count as right. */
const WITHIN_S = 2

/** A film's credits within this many seconds count as right (spike 2's bar). */
const FILM_WITHIN_S = 10

const isLabel = object({ start: isNumber, end: nullable(isNumber) })

const isEpisodeEntry = object({
  title: isString,
  file: isString,
  duration: isNumber,
  label: object({ intro: nullable(isLabel) }),
})

type EpisodeEntry = Infer<typeof isEpisodeEntry>

const isFilmEntry = object({
  title: isString,
  file: isString,
  duration: isNumber,
  label: object({ credits: isNumber }),
})

const isFixture = listOf(isRecord)

const isKept = object({ seconds: isNumber, points: listOf(isNumber) })

/** A cache file this script wrote: each region and path, and the fingerprint kept for it. */
const isCache = (value: unknown): value is Record<string, KeptFingerprint> =>
  isRecord(value) && Object.values(value).every(isKept)

type CacheKeyProps = { region: Region; path: string }

const cacheKey = ({ region, path }: CacheKeyProps): string => `${region}:${path}`

type ShowOf = { title: string; entries: EpisodeEntry[] }

/** The fixture's shows, each one season of episodes in file order. */
const showsOf = (fixture: readonly unknown[]): ShowOf[] =>
  Array.from(
    fixture
      .filter(isEpisodeEntry)
      .reduce(
        (shows, entry) => shows.set(entry.title, [...(shows.get(entry.title) ?? []), entry]),
        new Map<string, EpisodeEntry[]>(),
      ),
    ([title, entries]) => ({
      title,
      entries: entries.toSorted((a, b) => a.file.localeCompare(b.file)),
    }),
  )

const VERDICTS = {
  right: 'right',
  wrong: 'wrong',
  early: 'early',
  late: 'late',
  missed: 'missed',
  found: 'found',
  none: 'none',
  false: 'false',
} as const

type Verdict = (typeof VERDICTS)[keyof typeof VERDICTS]

type IntroVerdictProps = {
  label: EpisodeEntry['label']['intro']
  found: { start: number; end: number } | null
}

const introVerdict = ({ label, found }: IntroVerdictProps): Verdict => {
  if (label == null) return found == null ? VERDICTS.none : VERDICTS.false
  if (found == null) return VERDICTS.missed
  const isStartRight = Math.abs(found.start - label.start) <= WITHIN_S
  const isEndRight = label.end == null || Math.abs(found.end - label.end) <= WITHIN_S
  return isStartRight && isEndRight ? VERDICTS.right : VERDICTS.wrong
}

type StartVerdictProps = { label: number; found: number | null; within: number }

/** A start against its label: right within `within`, else early or late; missed when nothing was found. */
const startVerdict = ({ label, found, within }: StartVerdictProps): Verdict => {
  if (found === null) return VERDICTS.missed
  if (Math.abs(found - label) <= within) return VERDICTS.right
  return found < label ? VERDICTS.early : VERDICTS.late
}

const seconds = (value: number): string => value.toFixed(1)

type Row = { group: string; verdict: Verdict; line: string }

/** An episode of the fixture as detection reads it, with the credits its chapters name. */
type ScoredEpisode = {
  id: number
  path: string
  duration: number
  chapterStarts: number[]
  named: Marker | null
}

type ThemeVerdictProps = { named: Marker | null; found: Marker | null }

/** An end theme against a credits chapter where the file names one; without one, only whether a theme was found. */
const themeVerdict = ({ named, found }: ThemeVerdictProps): Verdict => {
  if (named !== null) {
    return startVerdict({ label: named.start, found: found?.start ?? null, within: WITHIN_S })
  }
  return found === null ? VERDICTS.none : VERDICTS.found
}

const creditsOf = (markers: readonly Marker[]): Marker | null =>
  markers.find(({ kind }) => kind === MARKER_KINDS.credits) ?? null

type MarkerOfProps = {
  markers: ReadonlyMap<number, readonly Marker[]>
  id: number
  kind: MarkerKind
}

/** The marker of a kind detection found for a file, or null. */
const markerOf = ({ markers, id, kind }: MarkerOfProps): Marker | null =>
  (markers.get(id) ?? []).find((marker) => marker.kind === kind) ?? null

type TallyProps = { rows: readonly Row[]; group: string }

const tally = ({ rows, group }: TallyProps) => {
  const of = rows.filter((row) => row.group === group)
  return (verdict: Verdict) => of.filter((row) => row.verdict === verdict).length
}

const GROUPS = {
  intro: 'intro',
  endTheme: 'end theme',
  crawl: 'crawl',
  shipped: 'film credits',
} as const

const main = async (): Promise<void> => {
  const [labelsPath, root, cachePath] = process.argv.slice(2)
  if (labelsPath === undefined || root === undefined) {
    throw new Error('Usage: markers:accuracy <labels.json> <media root> [cache.json]')
  }
  const fixture: unknown = JSON.parse(readFileSync(labelsPath, 'utf8'))
  if (!isFixture(fixture)) throw new Error(`${labelsPath} is not the labels fixture`)
  const read: unknown =
    cachePath !== undefined && existsSync(cachePath)
      ? JSON.parse(readFileSync(cachePath, 'utf8'))
      : {}
  const cache: Record<string, KeptFingerprint> = isCache(read) ? read : {}
  const ffmpeg = new FfmpegService(
    readServerConfig(process.env),
    {
      playback: () => DEFAULT_PLAYBACK_SETTINGS,
    },
    new ScanControl(),
  )
  const showRows = await showsOf(fixture).reduce<Promise<Row[]>>(
    async (previous, { title, entries }) => {
      const done = await previous
      const episodes = await entries.reduce<Promise<ScoredEpisode[]>>(async (listed, entry, id) => {
        const path = join(root, entry.file)
        const chapters = parseChapters(await ffmpeg.probeJson(path))
        return [
          ...(await listed),
          {
            id,
            path,
            duration: entry.duration,
            chapterStarts: chapters.map(({ start }) => start),
            named: creditsOf(chapterMarkers(chapters)),
          },
        ]
      }, Promise.resolve([]))
      const keptOf = (region: Region) =>
        new Map(
          episodes.flatMap(({ id, path }) => {
            const kept = cache[cacheKey({ region, path })]
            return kept === undefined ? [] : [[id, kept] as const]
          }),
        )
      const started = performance.now()
      const { markers, failed } = await detectSeasonMarkers({
        files: episodes,
        kept: { [REGIONS.head]: keptOf(REGIONS.head), [REGIONS.tail]: keptOf(REGIONS.tail) },
        tools: ffmpeg,
        onMade: ({ id, region, seconds: heard, points }) => {
          const path = episodes[id]?.path ?? null
          if (path !== null) cache[cacheKey({ region, path })] = { seconds: heard, points }
        },
      })

      const took = (performance.now() - started) / 1000
      console.log(
        `${title}: ${seconds(took)} s${failed.size > 0 ? `, ${failed.size} unreadable` : ''}`,
      )
      const name = title.slice(0, 24).padEnd(24)
      return [
        ...done,
        ...entries.map((entry, id): Row => {
          const found = markerOf({ markers, id, kind: MARKER_KINDS.intro })
          const label = entry.label.intro
          const verdict = introVerdict({ label, found })
          return {
            group: GROUPS.intro,
            verdict,
            line: [
              name,
              'intro'.padEnd(10),
              verdict.padEnd(7),
              label == null
                ? 'no intro'.padEnd(13)
                : `${label.start}-${label.end ?? '?'}`.padEnd(13),
              found == null
                ? '-'
                : `${seconds(found.start)}-${seconds(found.end)} (${found.confidence.toFixed(2)})`,
            ].join(' '),
          }
        }),
        ...episodes.map(({ id, named }): Row => {
          const found = markerOf({ markers, id, kind: MARKER_KINDS.credits })
          const verdict = themeVerdict({ named, found })
          return {
            group: GROUPS.endTheme,
            verdict,
            line: [
              name,
              'end theme'.padEnd(10),
              verdict.padEnd(7),
              (named === null ? 'no chapter' : `chapter ${seconds(named.start)}`).padEnd(13),
              found == null
                ? '-'
                : `${seconds(found.start)}-${seconds(found.end)} (${found.confidence.toFixed(2)})`,
            ].join(' '),
          }
        }),
      ]
    },
    Promise.resolve([]),
  )
  const filmRows = await fixture
    .filter(isFilmEntry)
    .reduce<Promise<Row[]>>(async (previous, entry) => {
      const done = await previous
      const path = join(root, entry.file)
      const started = performance.now()
      const crawl = await detectFilmCredits({ path, duration: entry.duration, tools: ffmpeg })
      const took = (performance.now() - started) / 1000
      const named = creditsOf(chapterMarkers(parseChapters(await ffmpeg.probeJson(path))))
      const shipped = strongest([named, crawl].filter((marker) => marker !== null))
      const label = entry.label.credits
      const crawlVerdict = startVerdict({
        label,
        found: crawl?.start ?? null,
        within: FILM_WITHIN_S,
      })
      const shippedVerdict = startVerdict({
        label,
        found: shipped?.start ?? null,
        within: FILM_WITHIN_S,
      })
      const name = entry.title.slice(0, 24).padEnd(24)
      const shown = (marker: Marker | null) =>
        marker === null ? '-' : `${seconds(marker.start)}-${seconds(marker.end)}`
      return [
        ...done,
        {
          group: GROUPS.crawl,
          verdict: crawlVerdict,
          line: `${name} ${'crawl'.padEnd(10)} ${crawlVerdict.padEnd(7)} ${String(label).padEnd(13)} ${shown(crawl)} (${seconds(took)} s)`,
        },
        {
          group: GROUPS.shipped,
          verdict: shippedVerdict,
          line: `${name} ${'shipped'.padEnd(10)} ${shippedVerdict.padEnd(7)} ${String(label).padEnd(13)} ${shown(shipped)}${named === null ? '' : ' (chapter)'}`,
        },
      ]
    }, Promise.resolve([]))
  if (cachePath !== undefined) writeFileSync(cachePath, JSON.stringify(cache))
  const rows = [...showRows, ...filmRows]
  rows.forEach(({ line }) => console.log(line))
  const intro = tally({ rows, group: GROUPS.intro })
  const labelled = intro(VERDICTS.right) + intro(VERDICTS.wrong) + intro(VERDICTS.missed)
  const share = labelled === 0 ? 0 : Math.round((intro(VERDICTS.right) / labelled) * 100)
  console.log(
    `Intros within ${WITHIN_S} s at both ends: ${intro(VERDICTS.right)} of ${labelled} (${share}%); ` +
      `markers on episodes labelled with none: ${intro(VERDICTS.false)} of ${intro(VERDICTS.none) + intro(VERDICTS.false)}`,
  )
  const theme = tally({ rows, group: GROUPS.endTheme })
  const placed = theme(VERDICTS.right) + theme(VERDICTS.early) + theme(VERDICTS.late)
  const named = placed + theme(VERDICTS.missed)
  console.log(
    `End themes: found on ${placed + theme(VERDICTS.found)} of ${rows.filter((row) => row.group === GROUPS.endTheme).length} episodes; ` +
      `against a credits chapter, ${theme(VERDICTS.right)} of ${named} within ${WITHIN_S} s, ${theme(VERDICTS.early)} early`,
  )
  const films = [GROUPS.crawl, GROUPS.shipped].map((group) => {
    const count = tally({ rows, group })
    return `${group}: ${count(VERDICTS.right)} within ${FILM_WITHIN_S} s, ${count(VERDICTS.early)} early, ${count(VERDICTS.late)} late, ${count(VERDICTS.missed)} none`
  })
  console.log(
    `Films of ${rows.filter((row) => row.group === GROUPS.crawl).length}: ${films.join('; ')}`,
  )
}

await main()
