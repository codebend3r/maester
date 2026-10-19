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
  type StreamMode,
  type StreamQuality,
} from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { hlsArgs } from '@/ffmpeg/args'
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

/** How long a request waits for its segment before giving up. */
export const HLS_SEGMENT_WAIT_MS = 30_000

/** How many sessions the server keeps; minting one more drops the longest idle. */
export const HLS_SESSION_CAP = 8

/** What a run is sent: killed, paused while it is too far ahead, resumed. */
export const RUN_SIGNALS = { kill: 'SIGKILL', stop: 'SIGSTOP', resume: 'SIGCONT' } as const

/** What every run of a session encodes with: the file, and what the caller decided for it. */
export type HlsEncoding = Omit<
  Parameters<typeof hlsArgs>[0],
  'plan' | 'from' | 'mode' | 'audio' | 'folder'
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
}

/** What a request for a session that ended while it waited is told. */
const sessionEnded = (): NotFoundException =>
  new NotFoundException('This stream session has ended; open the stream again')

type Waiter = { n: number; settle: (error: Error | null) => void }

/** One ffmpeg writing a session's segments, in order, from `from`. */
type Run = {
  child: FfmpegStream
  from: number
  /** The next segment it finishes. */
  next: number
  /** The furthest segment asked for since it started. */
  furthest: number
  isPaused: boolean
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
  cancelIdle: () => void
  run: Run | null
  /** The segments whole on disk. A file not listed here is never served. */
  written: Set<number>
  /** Cut from the first file a run finished; every run's first file has the same one. */
  init: Promise<Uint8Array | null> | null
  /** Requests take turns, so two never start runs over each other. */
  turn: Promise<unknown>
}

/**
 * The HLS streams being played: each a session whose segments one ffmpeg
 * run at a time writes into `<dataDir>/hls/<session>/`, started only when
 * a segment is asked for. A request is served from the folder when its
 * segment is whole there, waits when the run is about to write it, and
 * otherwise kills the run and starts one at that segment, which cuts the
 * same segments a run from the start would. A run that gets ten segments
 * ahead of the furthest asked for is paused until asked further. Only the
 * last `HLS_KEPT_SEGMENTS` behind the furthest asked stay on disk, and a
 * session nobody asks for in `HLS_IDLE_MS` is dropped with its folder.
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

  /** Opens a session. Nothing runs until a segment or the init is asked for. */
  mint({
    mediaId,
    mode,
    audio,
    quality,
    plan,
    encoding,
  }: {
    mediaId: number
    mode: StreamMode
    audio: AudioTrack | null
    quality: StreamQuality | null
    plan: SegmentPlan
    encoding: HlsEncoding
  }): HlsSession {
    const live = [...this.entries.values()]
    if (live.length >= HLS_SESSION_CAP) {
      this.end(
        live.reduce((idlest, entry) => (entry.lastAskedAt < idlest.lastAskedAt ? entry : idlest)),
      )
    }
    const session = {
      id: randomBytes(16).toString('base64url'),
      mediaId,
      mode,
      audio: audio?.index ?? null,
      quality,
      plan,
    }
    const entry: Entry = {
      session,
      audio,
      encoding,
      folder: join(this.root, session.id),
      lastAskedAt: this.clock.now(),
      cancelIdle: () => undefined,
      run: null,
      written: new Set(),
      init: null,
      turn: Promise.resolve(),
    }
    this.entries.set(session.id, entry)
    this.touch(entry)
    return session
  }

  /** The session, when it is open and plays this media. */
  get({ mediaId, session }: { mediaId: number; session: string }): HlsSession | null {
    const entry = this.entries.get(session)
    if (!entry || entry.session.mediaId !== mediaId) return null
    this.touch(entry)
    return entry.session
  }

  /** The `ftyp moov` every segment of the session plays after. */
  async init({ session }: { session: string }): Promise<Uint8Array> {
    const entry = this.entryOf(session)
    return this.inTurn({ entry, work: () => this.initOf(entry) })
  }

  /** Segment `n`'s `moof mdat` boxes, once it is whole. */
  async segment({ session, n }: { session: string; n: number }): Promise<Uint8Array> {
    const entry = this.entryOf(session)
    if (!Number.isInteger(n) || n < 0 || n >= entry.session.plan.boundaries.length) {
      throw new NotFoundException(`No segment ${n} in this stream`)
    }
    return this.inTurn({ entry, work: () => this.segmentOf({ entry, n }) })
  }

  /** Ends every session playing a media, whose file is gone. */
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

  private isLive(entry: Entry): boolean {
    return this.entries.get(entry.session.id) === entry
  }

  private async inTurn<T>({ entry, work }: { entry: Entry; work: () => Promise<T> }): Promise<T> {
    this.touch(entry)
    const result = entry.turn.then(() => {
      if (!this.isLive(entry)) throw sessionEnded()
      return work()
    })
    entry.turn = result.catch(() => undefined)
    try {
      return await result
    } finally {
      if (this.isLive(entry)) this.touch(entry)
    }
  }

  private touch(entry: Entry): void {
    entry.lastAskedAt = this.clock.now()
    entry.cancelIdle()
    entry.cancelIdle = this.clock.after({ ms: HLS_IDLE_MS, run: () => this.end(entry) })
  }

  private async initOf(entry: Entry): Promise<Uint8Array> {
    const cached = entry.init ? await entry.init : null
    if (cached) return cached
    // A first file that could not be read; the next run's first file gives it.
    entry.init = null
    const run = entry.run ?? (await this.restart({ entry, from: 0 }))
    await this.waitFor({ entry, run, n: run.from })
    const init = entry.init ? await entry.init : null
    if (!init) throw new Error('The first file of the stream could not be read')
    return init
  }

  private async segmentOf({ entry, n }: { entry: Entry; n: number }): Promise<Uint8Array> {
    if (entry.run) this.ask({ run: entry.run, n })
    if (!entry.written.has(n)) await this.produce({ entry, n })
    const file = await readFile(join(entry.folder, segmentFileName(n)))
    await this.prune({ entry, n })
    return splitSegmentFile(file).media
  }

  /** Waits for `n` from the run about to write it, or restarts the run there. */
  private async produce({ entry, n }: { entry: Entry; n: number }): Promise<void> {
    const current = entry.run
    const isNear = current != null && n >= current.next && n <= current.next + HLS_WAIT_AHEAD
    const run = isNear ? current : await this.restart({ entry, from: n })
    await this.waitFor({ entry, run, n })
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
    if (old) {
      old.child.kill(RUN_SIGNALS.kill)
      await old.closed
    }
    // The new run writes these again, and the old one may have left its next half written.
    const stale = [...entry.written].filter((k) => k >= from)
    stale.forEach((k) => entry.written.delete(k))
    const doomed = new Set([...stale, ...(old ? [old.next] : [])])
    await Promise.all(
      [...doomed].map((k) => rm(join(entry.folder, segmentFileName(k)), { force: true })),
    )
    await mkdir(entry.folder, { recursive: true })
    if (!this.isLive(entry)) {
      await rm(entry.folder, { recursive: true, force: true })
      throw sessionEnded()
    }
    return this.launch({ entry, from })
  }

  private launch({ entry, from }: { entry: Entry; from: number }): Run {
    const child = this.ffmpeg.segment(
      hlsArgs({
        ...entry.encoding,
        plan: entry.session.plan,
        from,
        mode: entry.session.mode,
        audio: entry.audio,
        folder: entry.folder,
      }),
    )
    const run: Run = {
      child,
      from,
      next: from,
      furthest: from,
      isPaused: false,
      waiters: new Set(),
      closed: new Promise<void>((resolve) => {
        child.once('close', () => resolve())
        child.once('error', () => resolve())
      }),
    }
    // The segment muxer lists a file on stdout once it has written and flushed all of it.
    createInterface({ input: child.stdout }).on('line', (line) =>
      this.finished({ entry, run, name: line.trim() }),
    )
    child.once('close', () => this.ended({ entry, run }))
    child.once('error', () => this.ended({ entry, run }))
    entry.run = run
    return run
  }

  private finished({ entry, run, name }: { entry: Entry; run: Run; name: string }): void {
    const n = segmentNumberOf(name)
    if (n == null || entry.run !== run) return
    entry.written.add(n)
    run.next = n + 1
    if (n === run.from) {
      entry.init ??= readFile(join(entry.folder, name))
        .then((bytes) => splitSegmentFile(bytes).init)
        .catch(() => null)
    }
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

  private waitFor({ entry, run, n }: { entry: Entry; run: Run; n: number }): Promise<void> {
    if (entry.written.has(n)) return Promise.resolve()
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

  /** Deletes what lies more than `HLS_KEPT_SEGMENTS` behind the furthest segment asked for. */
  private async prune({ entry, n }: { entry: Entry; n: number }): Promise<void> {
    const furthest = Math.max(n, entry.run?.furthest ?? n)
    const old = [...entry.written].filter((k) => k < furthest - HLS_KEPT_SEGMENTS)
    old.forEach((k) => entry.written.delete(k))
    await Promise.all(old.map((k) => rm(join(entry.folder, segmentFileName(k)), { force: true })))
  }

  /** Forgets a session, kills its run (paused or not) and deletes its folder once ffmpeg is gone. */
  private end(entry: Entry): void {
    if (!this.isLive(entry)) return
    this.entries.delete(entry.session.id)
    entry.cancelIdle()
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
