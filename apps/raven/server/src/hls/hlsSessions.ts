import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import {
  HLS_IDLE_MS,
  HLS_KEPT_SEGMENTS,
  MEDIA_TICKET_SECONDS,
  type StreamQuality,
} from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import type { HlsDialect } from '@/ffmpeg/ffmpegVersion'
import { type HlsSource, hlsArgs } from '@/ffmpeg/hlsArgs'
import { HLS_CLOCK, type HlsClock } from '@/hls/hlsClock'
import { splitSegmentFile } from '@/hls/segmentFiles'
import { RunReplaced, SegmentRun } from '@/hls/segmentRun'

/** How many times a request cuts its segment again when the listed file cannot be read. */
const MAX_READ_MISSES = 2

/**
 * How long an init with no run waits for a segment request to start one
 * before it starts its own at 0. Short, since a player may ask for the
 * init alone first and wait for it before asking for any segment, as
 * ExoPlayer's `HlsMediaChunk` does.
 */
export const HLS_INIT_GRACE_MS = 1500

/** How many sessions the server keeps; minting one more drops the longest idle. */
export const HLS_SESSION_CAP = 8

/** A session unasked for this long is forgotten: no ticket that opened it is still good. */
const HLS_RECORD_MS = MEDIA_TICKET_SECONDS * 1000

/**
 * The segments a session lets go of once `furthest` is asked for: all but
 * the last `HLS_KEPT_SEGMENTS` at or behind it.
 */
export const segmentsPastKeeping = ({
  segments,
  furthest,
}: {
  segments: Iterable<number>
  furthest: number
}): number[] => [...segments].filter((n) => n <= furthest - HLS_KEPT_SEGMENTS)

/** What a request for a session that ended while it waited is told. */
const sessionEnded = (): NotFoundException =>
  new NotFoundException('This stream session has ended; open the stream again')

/** No run started while an init waited for one, so it starts one itself. */
class LaunchTimeout extends Error {
  constructor() {
    super('No run started')
    this.name = 'LaunchTimeout'
  }
}

/**
 * A minted session: the media it plays, the size the viewer asked a
 * transcode for (null for the settings'), and the source every one of its
 * runs reads.
 */
export type HlsSession = HlsSource & { id: string; mediaId: number; asked: StreamQuality | null }

type Entry = {
  session: HlsSession
  keyframesFor: (() => readonly number[] | null) | null
  /** Whether it has said that a restart without keyframes may start late. */
  hasWarnedOfSeek: boolean
  folder: string
  lastAskedAt: number
  cancelTimers: () => void
  run: SegmentRun | null
  runs: number
  /** The whole file of each segment on disk. A file not listed here is never served. */
  written: Map<number, string>
  init: Uint8Array | null
  /** A run's first file, which the init is cut from when it is first asked for. */
  initSource: string | null
  /** Inits waiting for the next run to start. */
  launches: Set<() => void>
  /** Decisions take turns, so two never start runs over each other. */
  turn: Promise<unknown>
}

const STEPS = { ready: 'ready', wait: 'wait' } as const

/** What a request does next: read the file, or wait and decide again. */
type Step<T> =
  | { kind: typeof STEPS.ready; value: T }
  | { kind: typeof STEPS.wait; until: Promise<void> }

const ready = <T>(value: T): Step<T> => ({ kind: STEPS.ready, value })

/**
 * Waits for `until`, or rejects with the signal's reason once the request's
 * client has gone, so a request nobody reads any more starts no run when
 * its wait ends. What `until` settles with later is let go.
 */
const untilOrGone = ({
  until,
  signal,
}: {
  until: Promise<void>
  signal: AbortSignal | undefined
}): Promise<void> => {
  if (!signal) return until
  return new Promise<void>((resolve, reject) => {
    const gone = () => reject(signal.reason)
    if (signal.aborted) {
      gone()
      return
    }
    signal.addEventListener('abort', gone, { once: true })
    until.finally(() => signal.removeEventListener('abort', gone)).then(resolve, reject)
  })
}

/** Waits, then decides again; a run replaced under the wait is only a reason to ask again. */
const waitThenRetry = <T>(until: Promise<unknown>): Step<T> => ({
  kind: STEPS.wait,
  until: until.then(
    () => undefined,
    (error: unknown) => {
      if (!(error instanceof RunReplaced)) throw error
    },
  ),
})

/**
 * The HLS streams being played: each a session whose segments one ffmpeg
 * run at a time writes into `<dataDir>/hls/<session>/`, started only when
 * a segment is asked for. A request is served from the folder when its
 * segment is whole there, waits when the run is about to write it, and
 * otherwise has the run killed and one started at that segment, which cuts
 * the same segments a run from the start would. A run killed for a later
 * request has first written the segment it was started for, or stalled on
 * it, so every request is served in the end. A run ten segments ahead of
 * the furthest asked for is paused until asked further, and only the last
 * `HLS_KEPT_SEGMENTS` behind the furthest asked stay on disk.
 *
 * A session nobody asks for in `HLS_IDLE_MS` rests: its run is killed and
 * its files deleted, but it is kept, so a player paused for longer resumes
 * with a new run. It is forgotten after `MEDIA_TICKET_SECONDS` unasked, or
 * when it is the longest idle and an eighth is minted.
 */
@Injectable()
export class HlsSessions implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HlsSessions.name)
  private readonly root: string
  private readonly entries = new Map<string, Entry>()
  private readonly cleanups = new Set<Promise<void>>()

  constructor(
    @Inject(SERVER_CONFIG) config: ServerConfig,
    @Inject(FfmpegService) private readonly ffmpeg: FfmpegService,
    @Inject(HLS_CLOCK) private readonly clock: HlsClock,
  ) {
    this.root = join(config.dataDir, 'hls')
  }

  /** What is on disk belongs to sessions of the last run of the server, all gone. */
  onModuleInit(): void {
    rmSync(this.root, { recursive: true, force: true })
    mkdirSync(this.root, { recursive: true })
  }

  async onModuleDestroy(): Promise<void> {
    ;[...this.entries.values()].forEach((entry) => this.end(entry))
    await Promise.all(this.cleanups)
  }

  /** Opens a session. Nothing runs until a segment is asked for. */
  mint({
    mediaId,
    asked,
    source,
    keyframesFor,
  }: {
    mediaId: number
    asked: StreamQuality | null
    source: HlsSource
    /**
     * For a source whose seek lands mid-GOP (MPEG-TS), its keyframes as
     * far as they are known when a run starts; null for any other.
     */
    keyframesFor: (() => readonly number[] | null) | null
  }): HlsSession {
    const kept = [...this.entries.values()]
    if (kept.length >= HLS_SESSION_CAP) {
      this.end(
        kept.reduce((idlest, entry) => (entry.lastAskedAt < idlest.lastAskedAt ? entry : idlest)),
      )
    }
    const session = { ...source, id: randomBytes(16).toString('base64url'), mediaId, asked }
    const entry: Entry = {
      session,
      keyframesFor,
      hasWarnedOfSeek: false,
      folder: join(this.root, session.id),
      lastAskedAt: this.clock.now(),
      cancelTimers: () => undefined,
      run: null,
      runs: 0,
      written: new Map(),
      init: null,
      initSource: null,
      launches: new Set(),
      turn: Promise.resolve(),
    }
    this.entries.set(session.id, entry)
    this.touch(entry)
    return session
  }

  /** The session, when it is kept and plays this media. */
  get({ mediaId, session }: { mediaId: number; session: string }): HlsSession | null {
    const entry = this.entries.get(session)
    if (!entry || entry.session.mediaId !== mediaId) return null
    this.touch(entry)
    return entry.session
  }

  /**
   * The `ftyp moov` every segment of the session plays after, cut from a
   * run's first file and kept for the session's life, rests included. With
   * no run, it waits `HLS_INIT_GRACE_MS` for a segment request to start
   * one, and then starts one at segment 0 itself. `signal` is the
   * request's: once it aborts, the init is no longer waited for.
   */
  async init({ session, signal }: { session: string; signal?: AbortSignal }): Promise<Uint8Array> {
    return this.cutInit({ entry: this.entryOf(session), mayStart: false, signal })
  }

  /**
   * Segment `n`'s `moof mdat` boxes, once it is whole. `signal` is the
   * request's: once it aborts, the request decides nothing more, so a
   * client that left starts and kills no run.
   */
  async segment({
    session,
    n,
    signal,
  }: {
    session: string
    n: number
    signal?: AbortSignal
  }): Promise<Uint8Array> {
    const entry = this.entryOf(session)
    if (!Number.isInteger(n) || n < 0 || n >= entry.session.plan.boundaries.length) {
      throw new NotFoundException(`No segment ${n} in this stream`)
    }
    return this.serve({ entry, n, misses: 0, signal })
  }

  /** Forgets every session playing a media, whose file is gone. */
  drop({ mediaId }: { mediaId: number }): void {
    ;[...this.entries.values()]
      .filter((entry) => entry.session.mediaId === mediaId)
      .forEach((entry) => this.end(entry))
  }

  private entryOf(session: string): Entry {
    const entry = this.entries.get(session)
    if (!entry) throw new NotFoundException('No such stream session; open the stream again')
    return entry
  }

  private isKept(entry: Entry): boolean {
    return this.entries.get(entry.session.id) === entry
  }

  /** Runs `work` once every decision queued before it is done. */
  private enqueue<T>({ entry, work }: { entry: Entry; work: () => Promise<T> }): Promise<T> {
    const result = entry.turn.then(() => {
      if (!this.isKept(entry)) throw sessionEnded()
      return work()
    })
    entry.turn = result.catch(() => undefined)
    return result
  }

  /** A request's decision: it counts as the session being asked for, before and after. */
  private async inTurn<T>({ entry, work }: { entry: Entry; work: () => Promise<T> }): Promise<T> {
    this.touch(entry)
    try {
      return await this.enqueue({ entry, work })
    } finally {
      if (this.isKept(entry)) this.touch(entry)
    }
  }

  private touch(entry: Entry): void {
    entry.lastAskedAt = this.clock.now()
    entry.cancelTimers()
    const cancelRest = this.clock.after({ ms: HLS_IDLE_MS, run: () => this.rest(entry) })
    const cancelEnd = this.clock.after({ ms: HLS_RECORD_MS, run: () => this.end(entry) })
    entry.cancelTimers = () => {
      cancelRest()
      cancelEnd()
    }
  }

  /** `misses` counts the files listed for `n` that could not be read. */
  private async serve({
    entry,
    n,
    misses,
    signal,
  }: {
    entry: Entry
    n: number
    misses: number
    signal: AbortSignal | undefined
  }): Promise<Uint8Array> {
    const step = await this.inTurn({
      entry,
      work: async () => {
        signal?.throwIfAborted()
        return this.locate({ entry, n })
      },
    })
    if (step.kind === STEPS.wait) {
      await untilOrGone({ until: step.until, signal })
      return this.serve({ entry, n, misses, signal })
    }
    try {
      return splitSegmentFile(await readFile(step.value)).media
    } catch (error) {
      // Deleted since, as no longer kept or by a rest: cut it again, but not forever.
      if (misses >= MAX_READ_MISSES) throw error
      if (entry.written.get(n) === step.value) entry.written.delete(n)
      return this.serve({ entry, n, misses: misses + 1, signal })
    }
  }

  /** Where segment `n` is, or what to wait for before asking again. */
  private async locate({ entry, n }: { entry: Entry; n: number }): Promise<Step<string>> {
    const run = entry.run
    if (run) run.ask(n)
    const path = entry.written.get(n)
    if (path) {
      await this.prune({ entry, n })
      return ready(path)
    }
    if (run && run.writesSoon(n)) return waitThenRetry(run.waitFor(n))
    // A run is not killed before it has written what it was started for, or
    // stalled on it, so two requests far apart cannot keep replacing each
    // other's runs.
    if (run && !run.mayBeReplaced) {
      return waitThenRetry(
        run.waitForStart().catch((error: unknown) => {
          if (error instanceof NotFoundException) throw error
        }),
      )
    }
    const fresh = await this.restart({ entry, from: n })
    return waitThenRetry(fresh.waitFor(n))
  }

  private async cutInit({
    entry,
    mayStart,
    signal,
  }: {
    entry: Entry
    mayStart: boolean
    signal: AbortSignal | undefined
  }): Promise<Uint8Array> {
    const step = await this.inTurn({
      entry,
      work: async () => {
        signal?.throwIfAborted()
        return this.initStep({ entry, mayStart })
      },
    })
    if (step.kind === STEPS.ready) return step.value
    const hasTimedOut = await this.timedOut(untilOrGone({ until: step.until, signal }))
    return this.cutInit({ entry, mayStart: hasTimedOut, signal })
  }

  private async initStep({
    entry,
    mayStart,
  }: {
    entry: Entry
    mayStart: boolean
  }): Promise<Step<Uint8Array>> {
    if (entry.init) return ready(entry.init)
    if (entry.initSource) {
      // Read when asked, so a failed read is tried again on the next request.
      const bytes = await readFile(entry.initSource)
      entry.init = splitSegmentFile(bytes).init
      return ready(entry.init)
    }
    const run = entry.run
    if (run && !run.hasStarted) return waitThenRetry(run.waitFor(run.from))
    if (!mayStart) return { kind: STEPS.wait, until: this.nextLaunch(entry) }
    const fresh = await this.restart({ entry, from: 0 })
    return waitThenRetry(fresh.waitFor(0))
  }

  /** Whether waiting ended with no run started; the next launch resolves it false. */
  private timedOut(until: Promise<void>): Promise<boolean> {
    return until.then(
      () => false,
      (error: unknown) => {
        if (error instanceof LaunchTimeout) return true
        throw error
      },
    )
  }

  private nextLaunch(entry: Entry): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const launched = () => {
        cancel()
        resolve()
      }
      const cancel = this.clock.after({
        ms: HLS_INIT_GRACE_MS,
        run: () => {
          entry.launches.delete(launched)
          reject(new LaunchTimeout())
        },
      })
      entry.launches.add(launched)
    })
  }

  private async restart({ entry, from }: { entry: Entry; from: number }): Promise<SegmentRun> {
    await this.stopRun({ entry, reason: new RunReplaced() })
    const dialect = await this.ffmpeg.hlsDialect()
    entry.runs += 1
    // Each run writes into a folder of its own, so a segment another run
    // wrote stays whole and servable while this one writes its own.
    const folder = join(entry.folder, String(entry.runs))
    await mkdir(folder, { recursive: true })
    if (!this.isKept(entry)) {
      await rm(entry.folder, { recursive: true, force: true })
      throw sessionEnded()
    }
    const run = this.launch({ entry, from, folder, dialect })
    this.release(entry)
    return run
  }

  /** Takes the session's run off it and stops it, failing its waiters with `reason`. */
  private async stopRun({ entry, reason }: { entry: Entry; reason: Error }): Promise<void> {
    const run = entry.run
    entry.run = null
    if (run) await run.stop(reason)
  }

  /** Lets every init waiting for a run go and decide again. */
  private release(entry: Entry): void {
    entry.launches.forEach((launched) => launched())
    entry.launches.clear()
  }

  private launch({
    entry,
    from,
    folder,
    dialect,
  }: {
    entry: Entry
    from: number
    folder: string
    dialect: HlsDialect
  }): SegmentRun {
    const child = this.ffmpeg.segment(
      hlsArgs({
        source: entry.session,
        from,
        folder,
        seekKeyframes: this.seekKeyframesOf({ entry, from }),
        dialect,
      }),
    )
    const run = new SegmentRun({
      child,
      folder,
      from,
      last: entry.session.plan.boundaries.length - 1,
      clock: this.clock,
      onSegment: ({ n, path }) => this.record({ entry, n, path, isFirst: n === from }),
      onEnd: () => {
        if (entry.run === run) entry.run = null
      },
    })
    entry.run = run
    return run
  }

  /** A transport stream's keyframes for a restart, saying once per session when they are not probed yet. */
  private seekKeyframesOf({
    entry,
    from,
  }: {
    entry: Entry
    from: number
  }): readonly number[] | null {
    if (!entry.keyframesFor) return null
    const keyframes = entry.keyframesFor()
    if (keyframes == null && from > 0 && !entry.hasWarnedOfSeek) {
      entry.hasWarnedOfSeek = true
      this.logger.warn(
        `Media ${entry.session.mediaId}'s keyframes are not probed yet, so a restart at segment ${from} may start late`,
      )
    }
    return keyframes
  }

  /** Lists a segment a run has written whole, and its run's first file as the init's source. */
  private record({
    entry,
    n,
    path,
    isFirst,
  }: {
    entry: Entry
    n: number
    path: string
    isFirst: boolean
  }): void {
    if (entry.written.has(n)) {
      // Another run's copy is whole and may be being read; this one is spare.
      rm(path, { force: true }).catch(() => undefined)
    } else {
      entry.written.set(n, path)
    }
    if (isFirst && !entry.init) entry.initSource = entry.written.get(n) ?? null
  }

  /** Deletes all but the last `HLS_KEPT_SEGMENTS` at or behind the furthest asked for. */
  private async prune({ entry, n }: { entry: Entry; n: number }): Promise<void> {
    const furthest = Math.max(n, entry.run?.furthest ?? n)
    const paths = segmentsPastKeeping({ segments: entry.written.keys(), furthest })
      // The asked-for one is about to be read, and the init may still be cut from its source.
      .filter((k) => k !== n && entry.written.get(k) !== entry.initSource)
      .flatMap((k) => {
        const path = entry.written.get(k)
        entry.written.delete(k)
        return path == null ? [] : [path]
      })
    await Promise.all(paths.map((path) => rm(path, { force: true })))
  }

  /** Lets an idle session's run and files go, keeping the session to resume. */
  private rest(entry: Entry): void {
    this.enqueue({
      entry,
      work: async () => {
        await this.stopRun({ entry, reason: new RunReplaced() })
        entry.written.clear()
        entry.initSource = null
        await rm(entry.folder, { recursive: true, force: true })
      },
    }).catch((error: unknown) =>
      this.logger.warn(`Could not rest a stream session: ${errorMessage(error)}`),
    )
  }

  /** Forgets a session, kills its run and deletes its folder once ffmpeg is gone. */
  private end(entry: Entry): void {
    if (!this.isKept(entry)) return
    this.entries.delete(entry.session.id)
    entry.cancelTimers()
    this.release(entry)
    const cleanup: Promise<void> = this.stopRun({ entry, reason: sessionEnded() })
      .then(() => rm(entry.folder, { recursive: true, force: true }))
      .catch((error: unknown) =>
        this.logger.warn(`Could not delete a stream's segments: ${errorMessage(error)}`),
      )
      .finally(() => this.cleanups.delete(cleanup))
    this.cleanups.add(cleanup)
  }
}
