import { type ChildProcessByStdio, execFile, spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { type ProbeResult, parseProbe } from '@/ffmpeg/probe'

const run = promisify(execFile)

/** The last line ffmpeg printed before failing, which is usually the reason. */
const lastLine = (text: string): string =>
  text
    .split('\n')
    .findLast((line) => line.trim() !== '')
    ?.trim() ?? 'ffmpeg failed'

/**
 * ffmpeg or ffprobe ran out of time. Almost always the share being slow to
 * read rather than anything wrong with the file, so callers retry later
 * instead of recording a failure.
 */
export class FfmpegTimeoutError extends Error {
  constructor({ tool, seconds }: { tool: string; seconds: number }) {
    super(`${tool} gave up after ${seconds}s; the file or the share is slow to read`)
    this.name = 'FfmpegTimeoutError'
  }
}

/** execFile marks a run it killed for exceeding `timeout` with `killed: true`. */
const wasKilled = (error: unknown): boolean =>
  error instanceof Error && 'killed' in error && error.killed === true

const failureText = (error: unknown): string => {
  if (
    error instanceof Error &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.trim()
  ) {
    return lastLine(error.stderr)
  }
  return error instanceof Error ? error.message : String(error)
}

/** A running ffmpeg whose output is read as it is written. */
export type FfmpegStream = ChildProcessByStdio<null, Readable, Readable>

/** Everything that shells out to ffmpeg or ffprobe goes through here. */
@Injectable()
export class FfmpegService implements OnModuleDestroy {
  private readonly logger = new Logger(FfmpegService.name)
  private filters: Promise<ReadonlySet<string>> | null = null
  private readonly streams = new Set<FfmpegStream>()

  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  /** ffprobe's full `-show_format -show_streams` report, parsed but unchecked. */
  async probeJson(path: string): Promise<unknown> {
    try {
      const { stdout } = await run(
        this.config.ffprobePath,
        ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path],
        { maxBuffer: 16 * 1024 * 1024, timeout: this.config.ffmpegTimeoutSeconds * 1000 },
      )
      const parsed: unknown = JSON.parse(stdout)
      return parsed
    } catch (error) {
      if (wasKilled(error)) {
        throw new FfmpegTimeoutError({ tool: 'ffprobe', seconds: this.config.ffmpegTimeoutSeconds })
      }
      throw new Error(failureText(error), { cause: error })
    }
  }

  async probe(path: string): Promise<ProbeResult> {
    const result = parseProbe(await this.probeJson(path))
    if (!result) throw new Error('No audio or video streams')
    return result
  }

  /**
   * Starts ffmpeg writing to stdout, with no time limit: a stream lasts as
   * long as someone watches. The caller kills it when its reader goes
   * away; anything still running when the server stops is killed then.
   * A failure is logged with ffmpeg's own last line.
   */
  stream(args: string[]): FfmpegStream {
    const child = spawn(this.config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr = { tail: '' }
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.tail = (stderr.tail + chunk.toString()).slice(-4096)
    })
    child.on('error', (error) => this.logger.warn(`ffmpeg did not start: ${error.message}`))
    this.streams.add(child)
    child.on('close', (code, signal) => {
      this.streams.delete(child)
      if (code !== 0 && signal == null) {
        this.logger.warn(`ffmpeg stream failed (${code}): ${lastLine(stderr.tail)}`)
      }
    })
    return child
  }

  onModuleDestroy(): void {
    this.streams.forEach((child) => child.kill('SIGKILL'))
  }

  /** Runs ffmpeg to completion, rejecting with its own error line. */
  async exec(args: string[]): Promise<void> {
    try {
      await run(this.config.ffmpegPath, args, {
        timeout: this.config.ffmpegTimeoutSeconds * 1000,
        maxBuffer: 4 * 1024 * 1024,
      })
    } catch (error) {
      if (wasKilled(error)) {
        throw new FfmpegTimeoutError({ tool: 'ffmpeg', seconds: this.config.ffmpegTimeoutSeconds })
      }
      throw new Error(failureText(error), { cause: error })
    }
  }

  private availableFilters(): Promise<ReadonlySet<string>> {
    this.filters ??= run(this.config.ffmpegPath, ['-hide_banner', '-filters'], {
      maxBuffer: 4 * 1024 * 1024,
    })
      .then(
        ({ stdout }) =>
          new Set(stdout.split('\n').map((line) => line.trim().split(/\s+/)[1] ?? '')),
      )
      .catch(() => new Set<string>())
    return this.filters
  }

  /** Whether this ffmpeg can tone map HDR to SDR (it needs zscale from zimg). */
  async canTonemap(): Promise<boolean> {
    const filters = await this.availableFilters()
    return filters.has('zscale') && filters.has('tonemap')
  }

  /** "ffmpeg version 7.1.1-1+b1" style first line, or null when ffmpeg is missing. */
  async version(): Promise<string | null> {
    try {
      const { stdout } = await run(this.config.ffmpegPath, ['-hide_banner', '-version'])
      return stdout.split('\n')[0]?.trim() ?? null
    } catch {
      return null
    }
  }
}
