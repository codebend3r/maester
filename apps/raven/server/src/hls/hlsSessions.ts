import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type AudioTrack,
  HLS_IDLE_MS,
  HLS_KEPT_SEGMENTS,
  MEDIA_TICKET_SECONDS,
  type StreamMode,
  type StreamQuality,
} from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { type DemuxTimeBase, type SegmentClock, hlsArgs } from '@/ffmpeg/args'
import { type FfmpegStream, FfmpegService } from '@/ffmpeg/ffmpegService'
import { segmentFileName, segmentNumberOf, splitSegmentFile } from '@/hls/segmentFiles'
import type { SegmentPlan } from '@/hls/segmentPlan'

/** The clock and timers the sessions run on; a test moves them by hand. */
export type HlsClock = {
  now: () => number
  /** Calls `run` after `ms`; what it returns cancels that. */
  after: ({ ms, run }: { ms: number; run: () => void }) => () => void
}

/** The DI token the sessions' clock is provided under. */
export const HLS_CLOCK = Symbol('HLS_CLOCK')

export const SYSTEM_CLOCK: HlsClock = {
  now: () => Date.now(),
  after: ({ ms, run }) => {
    const timer = setTimeout(run, ms)
    // A session's timer alone never keeps the process alive.
    timer.unref()
    return () => clearTimeout(timer)
  },
}

/** How many segments a run may finish past the furthest one asked for before it is paused. */
const HLS_RUN_AHEAD = 10

/** How far past a run's next segment a request still waits for it instead of restarting. */
const HLS_WAIT_AHEAD = 2

/** How many times a request cuts its segment again when the listed file cannot be read. */
const MAX_READ_MISSES = 2

/** How long a request waits for its segment before giving up. */
export const HLS_SEGMENT_WAIT_MS = 30_000

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

/** What a run is sent: killed, paused while it is too far ahead, resumed. */
export const RUN_SIGNALS = { kill: 'SIGKILL', stop: 'SIGSTOP', resume: 'SIGCONT' } as const

/** What every run of a session encodes with: the file, and what the caller decided for it. */
export type HlsEncoding = Omit<
  Parameters<typeof hlsArgs>[0],
  'plan' | 'from' | 'mode' | 'audio' | 'folder' | 'segmentClock' | 'timeBase' | 'startTime'
>

/** A minted session: what it plays, and the plan its playlist and its runs share. */
export type HlsSession = {
  id: string
  mediaId: number
  mode: StreamMode
  /** The `0:a:N` track it plays, or null for a silent file. */
  audio: number | null
  /** The size the viewer asked a transcode for, or null for the settings'. */
  quality: StreamQuality | null
  plan: SegmentPlan
  /**
   * Where the file's own clock begins, ffprobe's `format.start_time`. The
   * plan is on that clock, and subtitles, extracted from zero, are not.
   */
  startTime: number
}

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

/** A run killed for a later request; whoever waited on it asks again. */
class RunReplaced extends Error {
  constructor() {
    super('A later request replaced the run')
    this.name = 'RunReplaced'
  }
}

/** No run started while an init waited for one, so it starts one itself. */
class LaunchTimeout extends Error {
  constructor() {
    super('No run started')
    this.name = 'LaunchTimeout'
  }
}

type Waiter = { n: number; settle: (error: Error | null) => void }

/** One ffmpeg writing a session's segments, in order, from `from`, into a folder of its own. */
type Run = {
  child: FfmpegStream
  folder: string
  from: number
  /** The next segment it finishes. */
  next: number
  /** The furthest segment asked for since it started. */
  furthest: number
  isPaused: boolean
  /** Its first segment took too long, so a far request need not wait for it. */
  hasStalled: boolean
  waiters: Set<Waiter>
  /** Settles once ffmpeg has exited and its pipes have closed. */
  closed: Promise<void>
}

type Entry = {
  session: HlsSession
  audio: AudioTrack | null
  encoding: HlsEncoding
  folder: string
  lastAskedAt: number
  cancelTimers: () => void
  run: Run | null
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
 * request has first written the segment it was started for, so every
 * request is served in the end. A run ten segments ahead of the furthest
 * asked for is paused until asked further, and only the last
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
    mode,
    audio,
    quality,
    plan,
    startTime,
    encoding,
  }: {
    mediaId: number
    mode: StreamMode
    audio: AudioTrack | null
    quality: StreamQuality | null
    plan: SegmentPlan
    startTime: number
    encoding: HlsEncoding
  }): HlsSession {
    const kept = [...this.entries.values()]
    if (kept.length >= HLS_SESSION_CAP) {
      this.end(
        kept.reduce((idlest, entry) => (entry.lastAskedAt < idlest.lastAskedAt ? entry : idlest)),
      )
    }
    const session = {
      id: randomBytes(16).toString('base64url'),
      mediaId,
      mode,
      audio: audio?.index ?? null,
      quality,
      plan,
      startTime,
    }
    const entry: Entry = {
      session,
      audio,
      encoding,
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
    if (run) this.ask({ run, n })
    const path = entry.written.get(n)
    if (path) {
      await this.prune({ entry, n })
      return ready(path)
    }
    if (run && n >= run.next && n <= run.next + HLS_WAIT_AHEAD) {
      return waitThenRetry(this.waitFor({ run, n }))
    }
    // A run is not killed before it has written what it was started for,
    // so two requests far apart cannot keep replacing each other's runs.
    if (run && run.next === run.from && !run.hasStalled) {
      return waitThenRetry(
        this.waitFor({ run, n: run.from }).catch((error: unknown) => {
          if (error instanceof ServiceUnavailableException) run.hasStalled = true
          if (error instanceof NotFoundException) throw error
        }),
      )
    }
    const fresh = await this.restart({ entry, from: n })
    return waitThenRetry(this.waitFor({ run: fresh, n }))
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
    if (run && run.next === run.from) return waitThenRetry(this.waitFor({ run, n: run.from }))
    if (!mayStart) return { kind: STEPS.wait, until: this.nextLaunch(entry) }
    const fresh = await this.restart({ entry, from: 0 })
    return waitThenRetry(this.waitFor({ run: fresh, n: 0 }))
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

  /** The run may go `HLS_RUN_AHEAD` past the furthest segment asked for. */
  private ask({ run, n }: { run: Run; n: number }): void {
    run.furthest = Math.max(run.furthest, n)
    if (run.isPaused && run.next - 1 < run.furthest + HLS_RUN_AHEAD) {
      run.isPaused = false
      run.child.kill(RUN_SIGNALS.resume)
    }
  }

  private async restart({ entry, from }: { entry: Entry; from: number }): Promise<Run> {
    const old = entry.run
    entry.run = null
    if (old) await this.stop({ run: old, reason: new RunReplaced() })
    const [segmentClock, timeBase] = await Promise.all([
      this.ffmpeg.segmentClock(),
      this.ffmpeg.demuxTimeBase(),
    ])
    entry.runs += 1
    // Each run writes into a folder of its own, so a segment another run
    // wrote stays whole and servable while this one writes its own.
    const folder = join(entry.folder, String(entry.runs))
    await mkdir(folder, { recursive: true })
    if (!this.isKept(entry)) {
      await rm(entry.folder, { recursive: true, force: true })
      throw sessionEnded()
    }
    const run = this.launch({ entry, from, folder, segmentClock, timeBase })
    entry.launches.forEach((launched) => launched())
    entry.launches.clear()
    return run
  }

  /** Kills a run, paused or not, and deletes the file it was halfway through. */
  private async stop({ run, reason }: { run: Run; reason: Error }): Promise<void> {
    ;[...run.waiters].forEach((waiter) => waiter.settle(reason))
    run.child.kill(RUN_SIGNALS.kill)
    await run.closed
    await rm(join(run.folder, segmentFileName(run.next)), { force: true })
  }

  private launch({
    entry,
    from,
    folder,
    segmentClock,
    timeBase,
  }: {
    entry: Entry
    from: number
    folder: string
    segmentClock: SegmentClock
    timeBase: DemuxTimeBase
  }): Run {
    const child = this.ffmpeg.segment(
      hlsArgs({
        ...entry.encoding,
        plan: entry.session.plan,
        from,
        mode: entry.session.mode,
        audio: entry.audio,
        startTime: entry.session.startTime,
        folder,
        segmentClock,
        timeBase,
      }),
    )
    const run: Run = {
      child,
      folder,
      from,
      next: from,
      furthest: from,
      isPaused: false,
      hasStalled: false,
      waiters: new Set(),
      closed: new Promise<void>((resolve) => {
        child.once('close', () => resolve())
        child.once('error', () => {
          if (child.pid === undefined) resolve()
        })
      }),
    }
    // The segment muxer lists a file on stdout once it has written and flushed all of it.
    createInterface({ input: child.stdout }).on('line', (line) =>
      this.finished({ entry, run, name: line.trim() }),
    )
    child.once('close', () => this.ended({ entry, run }))
    // Once spawned, an 'error' (a signal that could not be sent) leaves it running; only
    // 'close' ends it. One that never spawned has no pid and gets no 'close'.
    child.once('error', () => {
      if (child.pid === undefined) this.ended({ entry, run })
    })
    entry.run = run
    return run
  }

  private finished({ entry, run, name }: { entry: Entry; run: Run; name: string }): void {
    const n = segmentNumberOf(name)
    if (n == null || entry.run !== run) return
    const path = join(run.folder, name)
    if (entry.written.has(n)) {
      // Another run's copy is whole and may be being read; this one is spare.
      rm(path, { force: true }).catch(() => undefined)
    } else {
      entry.written.set(n, path)
    }
    run.next = n + 1
    if (n === run.from && !entry.init) entry.initSource = entry.written.get(n) ?? null
    ;[...run.waiters].filter((waiter) => waiter.n <= n).forEach((waiter) => waiter.settle(null))

    const isLast = n >= entry.session.plan.boundaries.length - 1
    if (!run.isPaused && !isLast && n >= run.furthest + HLS_RUN_AHEAD) {
      run.isPaused = true
      run.child.kill(RUN_SIGNALS.stop)
    }
  }

  private ended({ entry, run }: { entry: Entry; run: Run }): void {
    if (entry.run === run) entry.run = null
    ;[...run.waiters].forEach((waiter) =>
      waiter.settle(new Error(`ffmpeg stopped before writing segment ${waiter.n}`)),
    )
  }

  private waitFor({ run, n }: { run: Run; n: number }): Promise<void> {
    if (run.next > n) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        n,
        settle: (error) => {
          run.waiters.delete(waiter)
          cancel()
          if (error) {
            reject(error)
            return
          }
          resolve()
        },
      }
      const cancel = this.clock.after({
        ms: HLS_SEGMENT_WAIT_MS,
        run: () =>
          waiter.settle(new ServiceUnavailableException(`Segment ${n} was not ready in time`)),
      })
      run.waiters.add(waiter)
    })
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
        const run = entry.run
        entry.run = null
        if (run) await this.stop({ run, reason: new RunReplaced() })
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
    entry.launches.forEach((launched) => launched())
    entry.launches.clear()
    const run = entry.run
    entry.run = null
    if (run) {
      ;[...run.waiters].forEach((waiter) => waiter.settle(sessionEnded()))
      run.child.kill(RUN_SIGNALS.kill)
    }
    const cleanup: Promise<void> = (run?.closed ?? Promise.resolve())
      .then(() => rm(entry.folder, { recursive: true, force: true }))
      .catch((error: unknown) =>
        this.logger.warn(`Could not delete a stream's segments: ${errorMessage(error)}`),
      )
      .finally(() => this.cleanups.delete(cleanup))
    this.cleanups.add(cleanup)
  }
}
