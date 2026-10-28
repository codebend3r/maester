import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import {
  type DetectEpisode,
  type IntroTools,
  type SeasonDetection,
  type StoredHead,
  detectSeasonIntros,
} from '@/markers/introDetector'
import { type EpisodeFile, MarkerJobs } from '@/markers/markerJobs'
import { createTaskQueue } from '@/scanner/concurrency'
import { SettingsRepository } from '@/settings/settingsRepository'

type RunProps = { season: readonly EpisodeFile[]; only?: ReadonlySet<number> }

/** How long a season waits, each time, while ffmpeg converts a file for someone watching. */
export const YIELD_MS = 30_000

type Grouped = { primaries: EpisodeFile[]; extras: { at: number; file: EpisodeFile }[] }

/** Each episode's first file, its biggest picture, and the other versions beside it by episode position. */
const byEpisode = (files: readonly EpisodeFile[]): Grouped =>
  files.reduce<Grouped>(
    (grouped, file) => {
      const at = grouped.primaries.findIndex(({ episode }) => episode === file.episode)
      return at < 0
        ? { ...grouped, primaries: [...grouped.primaries, file] }
        : { ...grouped, extras: [...grouped.extras, { at, file }] }
    },
    { primaries: [], extras: [] },
  )

/**
 * Finds each season's intro in the background, a season at a time, after
 * a match pass has placed episodes in their seasons, and again on boot for
 * whatever was waiting when the server stopped: the database holds the
 * state, so nothing is lost to a restart or a recreated container. A
 * season waits while ffmpeg converts a file for someone watching, so
 * detection never starves a viewer. `MARKER_DETECTION=off` or the admin's
 * Detect intros setting turns it off.
 */
@Injectable()
export class MarkerDetection implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarkerDetection.name)
  private readonly queue
  private isStopping = false

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(MarkerJobs) private readonly jobs: MarkerJobs,
    @Inject(FfmpegService)
    private readonly ffmpeg: Pick<FfmpegService, 'fingerprint' | 'isConverting'>,
    @Inject(SettingsRepository) private readonly settings: Pick<SettingsRepository, 'playback'>,
  ) {
    this.queue = createTaskQueue({ concurrency: config.markerConcurrency })
  }

  onApplicationBootstrap(): void {
    this.kick()
  }

  onModuleDestroy(): void {
    this.isStopping = true
  }

  /** Queues every season waiting for detection; one already queued or running is left as it is. */
  kick(): void {
    if (!this.isOn()) return
    this.jobs
      .seasonsDue()
      .forEach((seasonId) =>
        this.queue.push({ key: `season:${seasonId}`, task: () => this.analyse(seasonId) }),
      )
  }

  whenIdle(): Promise<void> {
    return this.queue.idle()
  }

  private isOn(): boolean {
    return this.config.markerDetection && this.settings.playback().detectMarkers
  }

  private async givePlaybackWay(): Promise<void> {
    if (this.isStopping || !this.ffmpeg.isConverting()) return
    await new Promise((resolve) => setTimeout(resolve, YIELD_MS).unref())
    await this.givePlaybackWay()
  }

  private async analyse(seasonId: number): Promise<void> {
    await this.givePlaybackWay()
    if (this.isStopping || !this.isOn()) return
    const files = this.jobs.episodesOf(seasonId)
    try {
      const { intros, failed } = await this.detect(files)
      this.jobs.finish({ ids: files.map(({ id }) => id), intros, failed })
    } catch (error) {
      this.logger.warn(`Intro detection failed for season ${seasonId}: ${errorMessage(error)}`)
      this.jobs.finish({
        ids: files.map(({ id }) => id),
        intros: new Map(),
        failed: new Set(files.map(({ id }) => id)),
      })
    }
  }

  /**
   * The season's episodes matched once, a file each; then each other
   * version of an episode in its place, so a second file of an episode is
   * matched against the same neighbours rather than against its twin.
   */
  private async detect(files: readonly EpisodeFile[]): Promise<SeasonDetection> {
    const heads = new Map<number, StoredHead | null>(
      files.map(({ id }) => [id, this.jobs.storedHead(id)]),
    )
    const tools: IntroTools = {
      fingerprint: (stretch) => this.ffmpeg.fingerprint(stretch),
    }
    const run = ({ season, only }: RunProps) =>
      detectSeasonIntros({
        ...(only !== undefined && { only }),
        episodes: season.map((file): DetectEpisode => ({
          ...file,
          head: heads.get(file.id) ?? null,
        })),
        tools,
        onHead: ({ id, seconds, points }) => {
          heads.set(id, { seconds, points })
          this.jobs.saveHead({ id, seconds, points })
        },
      })
    const { primaries, extras } = byEpisode(files)
    const first = await run({ season: primaries })
    return extras.reduce<Promise<SeasonDetection>>(async (previous, { at, file }) => {
      const done = await previous
      const { intros, failed } = await run({
        season: primaries.with(at, file),
        only: new Set([file.id]),
      })
      const intro = intros.get(file.id)
      return {
        intros: intro == null ? done.intros : new Map(done.intros).set(file.id, intro),
        failed: failed.has(file.id) ? new Set(done.failed).add(file.id) : done.failed,
      }
    }, Promise.resolve(first))
  }
}
