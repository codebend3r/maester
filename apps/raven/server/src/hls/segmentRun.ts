import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ServiceUnavailableException } from '@nestjs/common'
import { FFMPEG_SIGNALS, type FfmpegStream } from '@/ffmpeg/ffmpegService'
import type { HlsClock } from '@/hls/hlsClock'
import { segmentNumberOf } from '@/hls/segmentFiles'

/** How many segments a run may finish past the furthest one asked for before it is paused. */
const HLS_RUN_AHEAD = 10

/** How far past a run's next segment a request still waits for it instead of restarting. */
const HLS_WAIT_AHEAD = 2

/** How long a request waits for its segment before giving up. */
export const HLS_SEGMENT_WAIT_MS = 30_000

/** What a run is sent: killed, paused while it is too far ahead, resumed. */
export const RUN_SIGNALS = {
  kill: FFMPEG_SIGNALS.kill,
  stop: 'SIGSTOP',
  resume: 'SIGCONT',
} as const

/** The run's child process and stdout line events it follows. */
export const RUN_EVENTS = { close: 'close', error: 'error', line: 'line' } as const

/** A run killed for a later request; whoever waited on it asks again. */
export class RunReplaced extends Error {
  constructor() {
    super('A later request replaced the run')
    this.name = 'RunReplaced'
  }
}

type Waiter = { n: number; settle: (error: Error | null) => void }

type OnSegmentProps = { n: number; path: string }

type SegmentRunPropsOnSegmentProps = { n: number; path: string }

type SegmentRunProps = {
  child: FfmpegStream
  folder: string
  from: number
  /** The plan's last segment, after which the run ends rather than pauses. */
  last: number
  clock: HlsClock
  /** Told of each segment the run finishes, and its file. */
  onSegment: ({ n, path }: SegmentRunPropsOnSegmentProps) => void
  /** Told once ffmpeg has exited, whether it finished or was killed. */
  onEnd: () => void
}

/**
 * One ffmpeg writing a session's segments, in order, from `from`, into a
 * folder of its own. The muxer lists each file on stdout once it has
 * written and flushed all of it, and the run hands it to its session then.
 * It is paused once it is `HLS_RUN_AHEAD` segments past the furthest asked
 * for, and resumed when asked further.
 */
export class SegmentRun {
  readonly from: number
  private readonly child: FfmpegStream
  private readonly folder: string
  private readonly last: number
  private readonly clock: HlsClock
  private readonly onSegment: ({ n, path }: OnSegmentProps) => void
  private readonly onEnd: () => void
  /** The next segment it finishes. */
  private next: number
  private furthestAsked: number
  private isPaused = false
  /** Its first segment took too long, so a far request need not wait for it. */
  private hasStalled = false
  /** Stopped or exited: nothing it lists from then on is its session's. */
  private isOver = false
  private readonly waiters = new Set<Waiter>()
  /** Settles once ffmpeg has exited and its pipes have closed. */
  private readonly closed: Promise<void>

  constructor({ child, folder, from, last, clock, onSegment, onEnd }: SegmentRunProps) {
    this.child = child
    this.folder = folder
    this.from = from
    this.next = from
    this.furthestAsked = from
    this.last = last
    this.clock = clock
    this.onSegment = onSegment
    this.onEnd = onEnd
    this.closed = new Promise<void>((resolve) => {
      child.once(RUN_EVENTS.close, () => resolve())
      child.once(RUN_EVENTS.error, () => {
        if (child.pid === undefined) resolve()
      })
    })
    createInterface({ input: child.stdout }).on(RUN_EVENTS.line, (line) =>
      this.finished(line.trim()),
    )
    child.once(RUN_EVENTS.close, () => this.ended())
    // Once spawned, an 'error' (a signal that could not be sent) leaves it running; only
    // 'close' ends it. One that never spawned has no pid and gets no 'close'.
    child.once(RUN_EVENTS.error, () => {
      if (child.pid === undefined) this.ended()
    })
  }

  /** The furthest segment asked for since it started. */
  get furthest(): number {
    return this.furthestAsked
  }

  /** Whether it has written the segment it was started for. */
  get hasStarted(): boolean {
    return this.next > this.from
  }

  /** Whether a far request may kill it: once it has started, or stalled before it could. */
  get canBeReplaced(): boolean {
    return this.hasStarted || this.hasStalled
  }

  /** Whether `n` is the segment it writes next or one just after, worth waiting for. */
  isWrittenSoon(n: number): boolean {
    return n >= this.next && n <= this.next + HLS_WAIT_AHEAD
  }

  /** Lets it go `HLS_RUN_AHEAD` past `n`, resuming it if it was paused short of that. */
  ask(n: number): void {
    this.furthestAsked = Math.max(this.furthestAsked, n)
    if (this.isPaused && this.next - 1 < this.furthestAsked + HLS_RUN_AHEAD) {
      this.isPaused = false
      this.child.kill(RUN_SIGNALS.resume)
    }
  }

  /** Settles once segment `n` is whole, or rejects when the run ends or `HLS_SEGMENT_WAIT_MS` pass first. */
  waitFor(n: number): Promise<void> {
    if (this.next > n) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        n,
        settle: (error) => {
          this.waiters.delete(waiter)
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
      this.waiters.add(waiter)
    })
  }

  /** Waits for the segment it was started for; one that does not come in time stalls the run. */
  waitForStart(): Promise<void> {
    return this.waitFor(this.from).catch((error: unknown) => {
      if (error instanceof ServiceUnavailableException) this.hasStalled = true
      throw error
    })
  }

  /**
   * Kills it, paused or not, failing its waiters with `reason`, and once
   * ffmpeg is gone deletes every file it had not finished: the one it was
   * halfway through, and any it listed too late to be its session's.
   */
  async stop(reason: Error): Promise<void> {
    this.isOver = true
    ;[...this.waiters].forEach((waiter) => waiter.settle(reason))
    this.child.kill(RUN_SIGNALS.kill)
    await this.closed
    const names = await readdir(this.folder).catch(() => [])
    const unfinished = names.filter((name) => {
      const n = segmentNumberOf(name)
      return n != null && n >= this.next
    })
    await Promise.all(unfinished.map((name) => rm(join(this.folder, name), { force: true })))
  }

  private finished(name: string): void {
    const n = segmentNumberOf(name)
    if (n == null || this.isOver) return
    this.onSegment({ n, path: join(this.folder, name) })
    this.next = n + 1
    ;[...this.waiters].filter((waiter) => waiter.n <= n).forEach((waiter) => waiter.settle(null))
    if (!this.isPaused && n < this.last && n >= this.furthestAsked + HLS_RUN_AHEAD) {
      this.isPaused = true
      this.child.kill(RUN_SIGNALS.stop)
    }
  }

  private ended(): void {
    this.isOver = true
    this.onEnd()
    ;[...this.waiters].forEach((waiter) =>
      waiter.settle(new Error(`ffmpeg stopped before writing segment ${waiter.n}`)),
    )
  }
}
