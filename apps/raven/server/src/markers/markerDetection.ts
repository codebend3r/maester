import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { MARKER_KINDS, MARKER_SOURCES } from '@raven/core'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { FfmpegService } from '@/ffmpeg/ffmpegService'
import { detectFilmCredits } from '@/markers/creditsDetector'
import type { KeptFingerprint } from '@/markers/fingerprintMatch'
import { type EpisodeFile, type FilmFile, MarkerJobs } from '@/markers/markerJobs'
import { REGIONS, type Region } from '@/markers/seasonListen'
import { type FoundMarkers, detectSeasonMarkers } from '@/markers/seasonMarkers'
import { createTaskQueue } from '@/scanner/concurrency'
import { SettingsRepository } from '@/settings/settingsRepository'

/** How long a job waits, each time, while ffmpeg converts a file for someone watching. */
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

type RunJobProps<File extends { id: number }> = {
  /** What the job is, for the log. */
  label: string
  /** The job's files, read once playback has given way, so they are current. */
  load: () => readonly File[]
  detect: (files: readonly File[]) => Promise<FoundMarkers>
}

type RunProps = { season: readonly EpisodeFile[]; only?: ReadonlySet<number> }

/**
 * Finds each season's intro and credits, and each film's credits, in the
 * background, a season or film at a time, after a match pass has placed
 * episodes in their seasons, and again on boot for whatever was waiting
 * when the server stopped: the database holds the state, so nothing is
 * lost to a restart or a recreated container. Each job waits while ffmpeg
 * converts a file for someone watching, so detection never starves a
 * viewer. `MARKER_DETECTION=off` or the admin's Find intros and credits
 * setting turns it off.
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
    private readonly ffmpeg: Pick<FfmpegService, 'fingerprint' | 'pictureStats' | 'isConverting'>,
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

  /** Queues every season and film waiting for detection; one already queued or running is left as it is. */
  kick(): void {
    if (!this.isOn()) return
    this.jobs.seasonsDue().forEach((seasonId) =>
      this.queue.push({
        key: `season:${seasonId}`,
        task: () =>
          this.runJob({
            label: `season ${seasonId}`,
            load: () => this.jobs.episodesOf(seasonId),
            detect: (files) => this.detectSeason(files),
          }),
      }),
    )
    this.jobs.filmsDue().forEach((film) =>
      this.queue.push({
        key: `media:${film.id}`,
        task: () =>
          this.runJob({
            label: film.path,
            load: () => [film],
            detect: () => this.detectFilm(film),
          }),
      }),
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

  /** One job: wait for playback, detect, and mark every file done or failed; a job that throws fails all its files. */
  private async runJob<File extends { id: number }>({
    label,
    load,
    detect,
  }: RunJobProps<File>): Promise<void> {
    await this.givePlaybackWay()
    if (this.isStopping || !this.isOn()) return
    const files = load()
    const ids = files.map(({ id }) => id)
    try {
      const { markers, failed } = await detect(files)
      this.jobs.finish({ ids, markers, failed })
    } catch (error) {
      this.logger.warn(`Marker detection failed for ${label}: ${errorMessage(error)}`)
      this.jobs.finish({ ids, markers: new Map(), failed: new Set(ids) })
    }
  }

  /** A film's credits by its crawl, unless its chapters or an admin already name them. */
  private async detectFilm(film: FilmFile): Promise<FoundMarkers> {
    const shouldLook = this.jobs.wouldTake({
      id: film.id,
      kind: MARKER_KINDS.credits,
      source: MARKER_SOURCES.visual,
    })
    const credits = shouldLook
      ? await detectFilmCredits({ path: film.path, duration: film.duration, tools: this.ffmpeg })
      : null
    return { markers: new Map(credits === null ? [] : [[film.id, [credits]]]), failed: new Set() }
  }

  private keptOf(files: readonly EpisodeFile[]): Record<Region, Map<number, KeptFingerprint>> {
    const of = (region: Region) =>
      new Map(
        files.flatMap(({ id }) => {
          const kept = this.jobs.stored({ id, region })
          return kept === null ? [] : [[id, kept] as const]
        }),
      )
    return { [REGIONS.head]: of(REGIONS.head), [REGIONS.tail]: of(REGIONS.tail) }
  }

  /**
   * The season's episodes matched once, a file each; then each other
   * version of an episode in its place, so a second file of an episode is
   * matched against the same neighbours rather than against its twin.
   */
  private async detectSeason(files: readonly EpisodeFile[]): Promise<FoundMarkers> {
    const kept = this.keptOf(files)
    const run = ({ season, only }: RunProps) =>
      detectSeasonMarkers({
        ...(only !== undefined && { only }),
        files: season,
        kept,
        tools: this.ffmpeg,
        onMade: (made) => {
          kept[made.region].set(made.id, { seconds: made.seconds, points: made.points })
          this.jobs.save(made)
        },
      })
    const { primaries, extras } = byEpisode(files)
    const first = await run({ season: primaries })
    return extras.reduce<Promise<FoundMarkers>>(async (previous, { at, file }) => {
      const done = await previous
      const more = await run({ season: primaries.with(at, file), only: new Set([file.id]) })
      return {
        markers: new Map([...done.markers, ...more.markers]),
        failed: more.failed.has(file.id) ? new Set([...done.failed, file.id]) : done.failed,
      }
    }, Promise.resolve(first))
  }
}
