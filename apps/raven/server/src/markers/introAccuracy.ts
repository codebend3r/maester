/**
 * Scores intro detection against the spike's hand labels, on the real
 * files: `bun run markers:accuracy <labels.json> <media root> [cache.json]`.
 * Each show of the fixture is one season; its episodes are fingerprinted,
 * matched and placed exactly as `MarkerDetection` does, and an intro counts
 * when both ends land within 2 s of the label. It needs the media, so it runs
 * where the libraries are (Vhagar), never in `verify`; its last result goes
 * in the PR that changes the detector. A cache file keeps the fingerprints
 * between runs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PLAYBACK_SETTINGS,
  type Infer,
  isNumber,
  isRecord,
  isString,
  listOf,
  nullable,
  object,
} from '@raven/core'
import { readServerConfig } from '@/config'
import { parseChapters } from '@/ffmpeg/chapters'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { type DetectEpisode, type StoredHead, detectSeasonIntros } from '@/markers/introDetector'

/** Both ends within this many seconds of the label count as right. */
const WITHIN_S = 2

const isLabel = object({ start: isNumber, end: nullable(isNumber) })

const isFixtureEntry = object({
  title: isString,
  file: isString,
  duration: isNumber,
  label: object({ intro: nullable(isLabel) }),
})

type FixtureEntry = Infer<typeof isFixtureEntry>

const isFixture = listOf(isRecord)

const isStoredHead = object({ seconds: isNumber, points: listOf(isNumber) })

/** A cache file this script wrote: each file's path, and the head fingerprint kept for it. */
const isCache = (value: unknown): value is Record<string, StoredHead> =>
  isRecord(value) && Object.values(value).every(isStoredHead)

type ShowOf = { title: string; entries: FixtureEntry[] }

/** The fixture's shows, each one season of episodes in file order; films carry no intro label and are left out. */
const showsOf = (fixture: readonly unknown[]): ShowOf[] =>
  Array.from(
    fixture
      .filter(isFixtureEntry)
      .reduce(
        (shows, entry) => shows.set(entry.title, [...(shows.get(entry.title) ?? []), entry]),
        new Map<string, FixtureEntry[]>(),
      ),
    ([title, entries]) => ({
      title,
      entries: entries.toSorted((a, b) => a.file.localeCompare(b.file)),
    }),
  )

type VerdictOfProps = {
  label: FixtureEntry['label']['intro']
  found: { start: number; end: number } | null
}

const VERDICTS = {
  right: 'right',
  wrong: 'wrong',
  missed: 'missed',
  none: 'none',
  false: 'false',
} as const

type Verdict = (typeof VERDICTS)[keyof typeof VERDICTS]

const verdictOf = ({ label, found }: VerdictOfProps): Verdict => {
  if (label == null) return found == null ? VERDICTS.none : VERDICTS.false
  if (found == null) return VERDICTS.missed
  const isStartRight = Math.abs(found.start - label.start) <= WITHIN_S
  const isEndRight = label.end == null || Math.abs(found.end - label.end) <= WITHIN_S
  return isStartRight && isEndRight ? VERDICTS.right : VERDICTS.wrong
}

const seconds = (value: number): string => value.toFixed(1)

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
  const cache: Record<string, StoredHead> = isCache(read) ? read : {}
  const ffmpeg = new FfmpegService(readServerConfig(process.env), {
    playback: () => DEFAULT_PLAYBACK_SETTINGS,
  })
  const tools = {
    fingerprint: ffmpeg.fingerprint.bind(ffmpeg),
  }
  const rows = await showsOf(fixture).reduce<
    Promise<{ title: string; verdict: Verdict; line: string }[]>
  >(async (previous, { title, entries }) => {
    const done = await previous
    const episodes = await entries.reduce<Promise<DetectEpisode[]>>(async (listed, entry, id) => {
      const path = join(root, entry.file)
      const chapters = parseChapters(await ffmpeg.probeJson(path))
      return [
        ...(await listed),
        {
          id,
          path,
          duration: entry.duration,
          chapterStarts: chapters.map(({ start }) => start),
          head: cache[path] ?? null,
        },
      ]
    }, Promise.resolve([]))
    const started = performance.now()
    const { intros, failed } = await detectSeasonIntros({
      episodes,
      tools,
      onHead: ({ id, seconds: heard, points }) => {
        const path = episodes[id]?.path ?? null
        if (path !== null) cache[path] = { seconds: heard, points }
      },
    })
    const took = (performance.now() - started) / 1000
    console.log(
      `${title}: ${seconds(took)} s${failed.size > 0 ? `, ${failed.size} unreadable` : ''}`,
    )
    return [
      ...done,
      ...entries.map((entry, id) => {
        const found = intros.get(id) ?? null
        const verdict = verdictOf({ label: entry.label.intro, found })
        const label = entry.label.intro
        return {
          title,
          verdict,
          line: [
            title.slice(0, 24).padEnd(24),
            verdict.padEnd(7),
            label == null ? 'no intro'.padEnd(13) : `${label.start}-${label.end ?? '?'}`.padEnd(13),
            found == null
              ? '-'
              : `${seconds(found.start)}-${seconds(found.end)} (${found.confidence.toFixed(2)})`,
          ].join(' '),
        }
      }),
    ]
  }, Promise.resolve([]))
  if (cachePath !== undefined) writeFileSync(cachePath, JSON.stringify(cache))
  rows.forEach(({ line }) => console.log(line))
  const count = (verdict: Verdict) => rows.filter((row) => row.verdict === verdict).length
  const labelled = count(VERDICTS.right) + count(VERDICTS.wrong) + count(VERDICTS.missed)
  const unlabelled = count(VERDICTS.none) + count(VERDICTS.false)
  const share = labelled === 0 ? 0 : Math.round((count(VERDICTS.right) / labelled) * 100)
  console.log(
    `Intros within ${WITHIN_S} s at both ends: ${count(VERDICTS.right)} of ${labelled} (${share}%); ` +
      `markers on episodes labelled with none: ${count(VERDICTS.false)} of ${unlabelled}`,
  )
}

await main()
