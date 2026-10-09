import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Inject, Injectable } from '@nestjs/common'
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

/** Everything that shells out to ffmpeg or ffprobe goes through here. */
@Injectable()
export class FfmpegService {
  private filters: Promise<ReadonlySet<string>> | null = null

  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  async probe(path: string): Promise<ProbeResult> {
    try {
      const { stdout } = await run(
        this.config.ffprobePath,
        ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path],
        { maxBuffer: 16 * 1024 * 1024, timeout: this.config.ffmpegTimeoutSeconds * 1000 },
      )
      const result = parseProbe(JSON.parse(stdout))
      if (!result) throw new Error('No audio or video streams')
      return result
    } catch (error) {
      if (wasKilled(error)) {
        throw new FfmpegTimeoutError({ tool: 'ffprobe', seconds: this.config.ffmpegTimeoutSeconds })
      }
      throw new Error(failureText(error), { cause: error })
    }
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
