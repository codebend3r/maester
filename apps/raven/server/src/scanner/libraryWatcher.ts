import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { errorMessage } from '@/errorMessage'
import { type LibraryRecord, LibrariesRepository, samePaths } from '@/libraries/librariesRepository'
import type { IsNetworkShare, WatchFolder, Watching } from '@/scanner/folderWatch'
import { ScannerService } from '@/scanner/scannerService'
import { isSkippedPlace } from '@/scanner/walk'

/** How the watcher watches and waits; a test makes the waits short. */
export type WatchOptions = {
  watchFolder: WatchFolder
  isNetworkShare: IsNetworkShare
  /** How long a library's folders must stay still before the places that changed are looked at. */
  quietMs: number
}

/** The DI token the watch options are provided under. */
export const WATCH_OPTIONS = Symbol('WATCH_OPTIONS')

const WATCH_MODES = { watching: 'watching', unwatched: 'unwatched' } as const

/**
 * A library's folders watched, with the places changed since they were last
 * looked at, and whether the watch hears of every change; or, failing that,
 * left to the quick scan.
 */
type Watch =
  | {
      mode: typeof WATCH_MODES.watching
      paths: readonly string[]
      watchers: Watching[]
      changed: Set<string>
      quiet: NodeJS.Timeout | null
      /** Every folder is on this machine's own disks; false until that is known. */
      isHeard: boolean
    }
  | { mode: typeof WATCH_MODES.unwatched; paths: readonly string[] }

type WatchedFolders = Extract<Watch, { mode: typeof WATCH_MODES.watching }>

type LibraryWatcherNoteChangeProps = { libraryId: number; root: string; path: string }

type LibraryWatcherFallBackProps = { library: LibraryRecord; error: unknown }

/**
 * Refreshes each library that refreshes automatically as its folders
 * change. Changes gather until the folders have been still for a moment (a
 * copy in progress keeps them busy), then just the places that changed are
 * looked at again. A watch hears only of changes made on this machine, so
 * a library with a folder on a share mounted from another one, or whose
 * folders cannot be watched (a share that went away, or a system out of
 * watches), is checked on a timer instead: a quiet quick scan that shows
 * only once it finds something new. One that cannot be watched is watched
 * again once any library is saved.
 */
@Injectable()
export class LibraryWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LibraryWatcher.name)
  private readonly watches = new Map<number, Watch>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(WATCH_OPTIONS) private readonly options: WatchOptions,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(ScannerService) private readonly scanner: ScannerService,
  ) {}

  onApplicationBootstrap(): void {
    this.sync()
    if (this.config.quickScanIntervalMinutes > 0) {
      this.timer = setInterval(
        () => this.checkUnheard(),
        this.config.quickScanIntervalMinutes * 60_000,
      )
      this.timer.unref()
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    Array.from(this.watches.keys()).forEach((id) => this.stop(id))
  }

  /** The libraries that refresh automatically and whose changes no watch hears of get a quiet quick scan. */
  checkUnheard(): void {
    this.libraries
      .list()
      .filter((library) => library.settings.autoRefresh && !this.isHeard(library.id))
      .forEach((library) => this.scanner.checkForChanges(library.id))
  }

  /** Whether the library's watch hears of every change to its folders. */
  private isHeard(libraryId: number): boolean {
    const watch = this.watches.get(libraryId) ?? null
    if (watch === null || watch.mode !== WATCH_MODES.watching) return false
    return watch.isHeard
  }

  /** Watches the libraries that refresh automatically, as they are now; run after any is saved. */
  sync(): void {
    const wanted = new Map(
      this.libraries
        .list()
        .filter((library) => library.settings.autoRefresh)
        .map((library) => [library.id, library]),
    )
    Array.from(this.watches.entries())
      .filter(
        ([id, watch]) =>
          watch.mode === WATCH_MODES.unwatched ||
          !samePaths({ before: watch.paths, after: wanted.get(id)?.paths ?? [] }),
      )
      .forEach(([id]) => this.stop(id))
    Array.from(wanted.values())
      .filter((library) => !this.watches.has(library.id))
      .forEach((library) => this.start(library))
  }

  private start(library: LibraryRecord): void {
    const watch: Watch = {
      mode: WATCH_MODES.watching,
      paths: library.paths,
      watchers: [],
      changed: new Set(),
      quiet: null,
      isHeard: false,
    }
    this.watches.set(library.id, watch)
    // Until it is known, the library is checked on the timer as well.
    this.hear(watch).catch((error: unknown) =>
      this.logger.warn(`Could not tell where "${library.name}" is: ${errorMessage(error)}`),
    )
    library.paths.forEach((root) => {
      const watcher = this.options.watchFolder({
        root,
        onChange: (path) => this.noteChange({ libraryId: library.id, root, path }),
        onError: (error) => this.fallBack({ library, error }),
      })
      // A watch that failed as it was set up has already fallen back to the timer.
      if (this.watches.get(library.id) === watch) watch.watchers.push(watcher)
      else watcher.close()
    })
  }

  /** Finds out whether every folder of the watch is on this machine's own disks. */
  private async hear(watch: WatchedFolders): Promise<void> {
    const shares = await Promise.all(watch.paths.map((root) => this.options.isNetworkShare(root)))
    watch.isHeard = !shares.includes(true)
  }

  private stop(libraryId: number): void {
    const watch = this.watches.get(libraryId)
    if (!watch) return
    switch (watch.mode) {
      case WATCH_MODES.watching:
        watch.watchers.forEach((watcher) => watcher.close())
        if (watch.quiet) clearTimeout(watch.quiet)
        break
      case WATCH_MODES.unwatched:
        break
      default: {
        const unknown: never = watch
        return unknown
      }
    }
    this.watches.delete(libraryId)
  }

  /** Hidden and NAS folders churn on their own; nothing in them is indexed. */
  private noteChange({ libraryId, root, path }: LibraryWatcherNoteChangeProps) {
    const watch = this.watches.get(libraryId)
    if (watch?.mode !== WATCH_MODES.watching || isSkippedPlace({ root, path })) return
    watch.changed.add(path)
    if (watch.quiet) clearTimeout(watch.quiet)
    watch.quiet = setTimeout(() => this.settle(libraryId), this.options.quietMs)
  }

  /** The folders have been still long enough: the places that changed are looked at again. */
  private settle(libraryId: number): void {
    const watch = this.watches.get(libraryId)
    if (watch?.mode !== WATCH_MODES.watching) return
    watch.quiet = null
    this.scanner.refresh({ libraryId, places: [...watch.changed] })
    watch.changed.clear()
  }

  private fallBack({ library, error }: LibraryWatcherFallBackProps): void {
    if (this.watches.get(library.id)?.mode !== WATCH_MODES.watching) return
    this.logger.warn(
      `Could not watch the folders of "${library.name}" (${errorMessage(error)}); its quick scan will find the changes`,
    )
    this.stop(library.id)
    this.watches.set(library.id, { mode: WATCH_MODES.unwatched, paths: library.paths })
  }
}
