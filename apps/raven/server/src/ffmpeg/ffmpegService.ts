import { type ChildProcessByStdio, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setPriority } from 'node:os'
import type { Readable } from 'node:stream'
import { promisify } from 'node:util'
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { type Chapter, ENCODER_KINDS, HW_ACCELS } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { SettingsRepository } from '@/settings/settingsRepository'
import { ScanControl } from '@/scanner/scanControl'
import { encoderTestArgs } from '@/ffmpeg/args'
import { parseChapters } from '@/ffmpeg/chapters'
import { SOFTWARE, type VideoEncoder, encoderCandidates } from '@/ffmpeg/encoder'
import { type HlsDialect, hlsDialectOf, toolMismatch } from '@/ffmpeg/ffmpegVersion'
import { parseKeyframes } from '@/ffmpeg/keyframes'
import { type PictureStat, parsePictureStats } from '@/ffmpeg/pictureStats'
import { type ProbeResult, parseProbe } from '@/ffmpeg/probe'
import { type FileTracks, parseTracks } from '@/ffmpeg/tracks'

const run = promisify(execFile)

/** The last line ffmpeg printed before failing, which is usually the reason. */
const lastLine = (text: string): string =>
  text
    .split('\n')
    .findLast((line) => line.trim() !== '')
    ?.trim() ?? 'ffmpeg failed'

type FfmpegTimeoutErrorProps = { tool: string; seconds: number }

type FfmpegServiceExecProps = { args: string[]; timeoutSeconds?: number }

/**
 * ffmpeg or ffprobe ran out of time. Almost always the share being slow to
 * read rather than anything wrong with the file, so callers retry later
 * instead of recording a failure.
 */
export class FfmpegTimeoutError extends Error {
  constructor({ tool, seconds }: FfmpegTimeoutErrorProps) {
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

/** `nice`'s lowest priority. */
const LOWEST_PRIORITY = 19

type FfmpegServiceFingerprintProps = { path: string; start: number; seconds: number }

type FfmpegServicePictureStatsProps = { path: string; start: number }

/**
 * A picture pass: one frame a second, keyframes only, scaled small, with
 * the mean saturation and the share of pixels darker than luma 32 printed
 * for each.
 */
const PICTURE_FILTERS =
  'fps=1,scale=320:-2,signalstats,blackframe=amount=0:threshold=32,metadata=mode=print:file=-'

/** The signals raven sends an ffmpeg it started. */
export const FFMPEG_SIGNALS = { kill: 'SIGKILL' } as const satisfies Record<string, NodeJS.Signals>

/** A running ffmpeg whose output is read as it is written. */
export type FfmpegStream = ChildProcessByStdio<null, Readable, Readable>

type FfmpegServiceSpawnTrackedProps = { args: string[]; purpose: string }

/** Everything that shells out to ffmpeg or ffprobe goes through here. */
@Injectable()
export class FfmpegService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FfmpegService.name)
  private filters: Promise<ReadonlySet<string>> | null = null
  private encoder: Promise<VideoEncoder> | null = null
  private versionLine: Promise<string | null> | null = null
  private readonly streams = new Set<FfmpegStream>()

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(SettingsRepository) private readonly settings: Pick<SettingsRepository, 'playback'>,
    @Inject(ScanControl) private readonly scans: ScanControl,
  ) {}

  /** ffprobe's full `-show_format -show_streams -show_chapters` report, parsed but unchecked. */
  async probeJson(path: string): Promise<unknown> {
    try {
      const { stdout } = await run(
        this.config.ffprobePath,
        ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', path],
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

  /**
   * The seconds of the file's video keyframes, ascending and cut to three
   * decimals; `V` reads the real video, never cover art. ffprobe lists
   * packets without decoding them, but it still reads the whole file, so it
   * has its own time limit.
   */
  async probeKeyframes(path: string): Promise<number[]> {
    try {
      const { stdout } = await run(
        this.config.ffprobePath,
        [
          '-v',
          'error',
          '-select_streams',
          'V:0',
          '-show_entries',
          'packet=pts_time,flags',
          '-of',
          'csv=p=0',
          path,
        ],
        { maxBuffer: 256 * 1024 * 1024, timeout: this.config.keyframeProbeTimeoutSeconds * 1000 },
      )
      return parseKeyframes(stdout)
    } catch (error) {
      if (wasKilled(error)) {
        throw new FfmpegTimeoutError({
          tool: 'ffprobe',
          seconds: this.config.keyframeProbeTimeoutSeconds,
        })
      }
      throw new Error(failureText(error), { cause: error })
    }
  }

  /**
   * The Chromaprint points of the file's first audio track from `start`,
   * for `seconds`: ffmpeg's `chromaprint` muxer, raw, one 32 bit point per
   * `POINT_SECONDS`.
   */
  async fingerprint({ path, start, seconds }: FfmpegServiceFingerprintProps): Promise<number[]> {
    const out = await this.analyse([
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-ss',
      String(start),
      '-t',
      String(seconds),
      '-i',
      path,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-f',
      'chromaprint',
      '-fp_format',
      'raw',
      '-',
    ])
    return Array.from({ length: Math.floor(out.length / 4) }, (_, index) =>
      out.readUInt32LE(index * 4),
    )
  }

  /**
   * Each second of the file's first video track from `start` to its end,
   * read from keyframes only so a 4K film's last 15 minutes take a minute
   * rather than ten: its saturation and how dark it is (`parsePictureStats`).
   */
  async pictureStats({ path, start }: FfmpegServicePictureStatsProps): Promise<PictureStat[]> {
    const out = await this.analyse([
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-skip_frame',
      'nokey',
      '-ss',
      String(start),
      '-i',
      path,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-vf',
      PICTURE_FILTERS,
      '-f',
      'null',
      '-',
    ])
    return parsePictureStats({ text: out.toString(), start })
  }

  /** Whether ffmpeg is converting a file for someone watching, which background analysis gives way to. */
  isConverting(): boolean {
    return this.streams.size > 0
  }

  /**
   * An ffmpeg run whose stdout is the answer, at the lowest CPU priority:
   * analysis is background work, and gives way to playback's own ffmpeg.
   */
  private analyse(args: string[]): Promise<Buffer> {
    const seconds = this.config.markerTimeoutSeconds
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.config.ffmpegPath,
        args,
        {
          encoding: 'buffer',
          timeout: seconds * 1000,
          maxBuffer: 64 * 1024 * 1024,
          signal: this.scans.signal,
        },
        (error, stdout, stderr) => {
          if (error == null) {
            resolve(stdout)
            return
          }
          if (wasKilled(error)) {
            reject(new FfmpegTimeoutError({ tool: 'ffmpeg', seconds }))
            return
          }
          const said = lastLine(stderr.toString())
          reject(new Error(said === '' ? error.message : said, { cause: error }))
        },
      )
      try {
        if (child.pid !== undefined) setPriority(child.pid, LOWEST_PRIORITY)
      } catch {
        // A platform that will not lower it runs the analysis at normal priority.
      }
    })
  }

  /** One ffprobe run, read three ways: what the index keeps, the file's tracks and its chapters. */
  async probeFile(
    path: string,
  ): Promise<{ probe: ProbeResult; tracks: FileTracks; chapters: Chapter[] }> {
    const output = await this.probeJson(path)
    const probe = parseProbe(output)
    if (!probe) throw new Error('No audio or video streams')
    return { probe, tracks: parseTracks(output), chapters: parseChapters(output) }
  }

  /**
   * Starts ffmpeg writing to stdout, with no time limit: a stream lasts as
   * long as someone watches. The caller kills it when its reader goes
   * away; anything still running when the server stops is killed then.
   * A failure is logged with ffmpeg's own last line.
   */
  stream(args: string[]): FfmpegStream {
    return this.spawnTracked({ args, purpose: 'stream' })
  }

  /**
   * Starts an HLS segment run, which writes its segments to files and lists
   * each on stdout as it closes it. Like a stream it has no time limit, its
   * caller kills it, and the server kills what is left when it stops.
   */
  segment(args: string[]): FfmpegStream {
    return this.spawnTracked({ args, purpose: 'segment run' })
  }

  private spawnTracked({ args, purpose }: FfmpegServiceSpawnTrackedProps): FfmpegStream {
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
        this.logger.warn(`ffmpeg ${purpose} failed (${code}): ${lastLine(stderr.tail)}`)
      }
    })
    return child
  }

  /** How this ffmpeg takes an HLS run's version-dependent flags, from its version. */
  async hlsDialect(): Promise<HlsDialect> {
    return hlsDialectOf(await this.ffmpegVersion())
  }

  /**
   * Settles the encoder at start, so the log says which one transcodes will
   * use, and says when ffprobe and ffmpeg are different builds.
   */
  onApplicationBootstrap(): void {
    this.videoEncoder().catch((error: unknown) => this.logger.warn(errorMessage(error)))
    this.warnOfMismatchedTools().catch((error: unknown) => this.logger.warn(errorMessage(error)))
  }

  /**
   * A transcode seeks from the file's start time as ffprobe reads it, and
   * builds disagree on it: 5.1 and 6.1 put an AAC-primed file's at -0.023 s,
   * 9.0 at 0. Two different builds can cut a run off its plan.
   */
  async warnOfMismatchedTools(): Promise<void> {
    const [ffmpeg, ffprobe] = await Promise.all([
      this.ffmpegVersion(),
      this.toolVersion(this.config.ffprobePath),
    ])
    const mismatch = toolMismatch({ ffmpeg, ffprobe })
    if (mismatch) this.logger.warn(mismatch)
  }

  onModuleDestroy(): void {
    this.streams.forEach((child) => child.kill(FFMPEG_SIGNALS.kill))
  }

  /**
   * How transcodes encode: the first GPU encoder whose test encode works,
   * else libx264. Decided once per run, since the hardware does not change.
   */
  videoEncoder(): Promise<VideoEncoder> {
    this.encoder ??= this.chooseEncoder()
    return this.encoder
  }

  /** Forgets the chosen encoder, so the next transcode chooses again under new settings. */
  resetEncoder(): void {
    this.encoder = null
  }

  private async chooseEncoder(): Promise<VideoEncoder> {
    // The setting wins over HW_ACCEL, unless it leaves the choice to the machine.
    const preferred = this.settings.playback().hwAccel
    const candidates = encoderCandidates({
      hwAccel: preferred === HW_ACCELS.auto ? this.config.hwAccel : preferred,
      platform: process.platform,
      vaapiDevice: this.config.vaapiDevice,
      deviceExists: existsSync(this.config.vaapiDevice),
    })
    const working = await candidates.reduce<Promise<VideoEncoder | null>>(
      async (found, candidate) =>
        (await found) ?? ((await this.encodes(candidate)) ? candidate : null),
      Promise.resolve(null),
    )
    const chosen = working ?? SOFTWARE
    this.logger.log(
      `Transcodes encode with ${chosen.kind === ENCODER_KINDS.software ? 'libx264 on the CPU' : chosen.kind}`,
    )
    return chosen
  }

  private async encodes(encoder: VideoEncoder): Promise<boolean> {
    try {
      await run(this.config.ffmpegPath, encoderTestArgs(encoder), { timeout: 30_000 })
      return true
    } catch (error) {
      this.logger.warn(`${encoder.kind} cannot encode here: ${failureText(error)}`)
      return false
    }
  }

  /**
   * Runs ffmpeg to completion, rejecting with its own error line. It may take
   * `timeoutSeconds`, `FFMPEG_TIMEOUT_SECONDS` unless a run that reads a whole
   * file says otherwise.
   */
  async exec({
    args,
    timeoutSeconds = this.config.ffmpegTimeoutSeconds,
  }: FfmpegServiceExecProps): Promise<void> {
    try {
      await run(this.config.ffmpegPath, args, {
        timeout: timeoutSeconds * 1000,
        maxBuffer: 4 * 1024 * 1024,
      })
    } catch (error) {
      if (wasKilled(error)) {
        throw new FfmpegTimeoutError({ tool: 'ffmpeg', seconds: timeoutSeconds })
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
    return this.toolVersion(this.config.ffmpegPath)
  }

  /** ffmpeg's `-version` line, asked once. */
  private ffmpegVersion(): Promise<string | null> {
    this.versionLine ??= this.version()
    return this.versionLine
  }

  private async toolVersion(path: string): Promise<string | null> {
    try {
      const { stdout } = await run(path, ['-hide_banner', '-version'])
      return stdout.split('\n')[0]?.trim() ?? null
    } catch {
      return null
    }
  }
}
