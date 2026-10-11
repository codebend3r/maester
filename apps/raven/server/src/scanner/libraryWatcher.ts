import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { type LibraryRecord, LibrariesRepository, samePaths } from '@/libraries/librariesRepository'
import type { WatchFolder, Watching } from '@/scanner/folderWatch'
import { ScannerService } from '@/scanner/scannerService'
import { isSkippedPlace, isUnder } from '@/scanner/walk'

/** How the watcher watches and waits; a test makes the waits short. */
export type WatchOptions = {
  watchFolder: WatchFolder
  /** How long a library's folders must stay still before the places that changed are looked at. */
  quietMs: number
  /** How often a library whose folders cannot be watched is scanned instead. */
  fallbackScanMs: number
}

/** The DI token the watch options are provided under. */
export const WATCH_OPTIONS = Symbol('WATCH_OPTIONS')

type Watch = {
  /** The library paths watched, to tell when they change. */
  paths: readonly string[]
  watchers: Watching[]
  /** Places that changed since the last refresh. */
  changed: Set<string>
  quiet: NodeJS.Timeout | null
  refreshing: boolean
  /** Scans the library on a timer once its folders could not be watched. */
  fallback: NodeJS.Timeout | null
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Refreshes each library that refreshes automatically as its folders
 * change. Changes gather until the folders have been still for a moment
 * (a copy in progress keeps them busy), then just the places that changed
 * are looked at again. A library whose folders cannot be watched (a share
 * that went away, or a system out of watches) is scanned on a timer
 * instead, until it is next saved.
 */
@Injectable()
export class LibraryWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LibraryWatcher.name)
  private readonly watches = new Map<number, Watch>()

  constructor(
    @Inject(WATCH_OPTIONS) private readonly options: WatchOptions,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(ScannerService) private readonly scanner: ScannerService,
  ) {}

  onApplicationBootstrap(): void {
    this.sync()
  }

  onModuleDestroy(): void {
    Array.from(this.watches.keys()).forEach((id) => this.stop(id))
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
      .filter(([id, watch]) => !samePaths(watch.paths, wanted.get(id)?.paths ?? []))
      .forEach(([id]) => this.stop(id))
    Array.from(wanted.values())
      .filter((library) => !this.watches.has(library.id))
      .forEach((library) => this.start(library))
  }

  private start(library: LibraryRecord): void {
    const watch: Watch = {
      paths: library.paths,
      watchers: [],
      changed: new Set(),
      quiet: null,
      refreshing: false,
      fallback: null,
    }
    this.watches.set(library.id, watch)
    watch.watchers = library.paths.map((root) =>
      this.options.watchFolder({
        root,
        onChange: (path) => this.noteChange({ libraryId: library.id, root, path }),
        onError: (error) => this.fallBack({ library, error }),
      }),
    )
  }

  private stop(libraryId: number): void {
    const watch = this.watches.get(libraryId)
    if (!watch) return
    watch.watchers.forEach((watcher) => watcher.close())
    if (watch.quiet) clearTimeout(watch.quiet)
    if (watch.fallback) clearInterval(watch.fallback)
    this.watches.delete(libraryId)
  }

  /** Hidden and NAS folders churn on their own; nothing in them is indexed. */
  private noteChange({ libraryId, root, path }: { libraryId: number; root: string; path: string }) {
    const watch = this.watches.get(libraryId)
    if (!watch || !isUnder({ path, root }) || isSkippedPlace({ root, path })) return
    watch.changed.add(path)
    if (watch.quiet) clearTimeout(watch.quiet)
    watch.quiet = setTimeout(() => void this.refresh(libraryId), this.options.quietMs)
  }

  /** One refresh at a time per library; what changes meanwhile waits for the next. */
  private async refresh(libraryId: number): Promise<void> {
    const watch = this.watches.get(libraryId)
    if (!watch || watch.refreshing || watch.changed.size === 0) return
    const places = [...watch.changed]
    watch.changed.clear()
    watch.refreshing = true
    try {
      await this.scanner.refresh({ libraryId, places })
    } finally {
      watch.refreshing = false
    }
    await this.refresh(libraryId)
  }

  private fallBack({ library, error }: { library: LibraryRecord; error: unknown }): void {
    const watch = this.watches.get(library.id)
    if (!watch || watch.fallback) return
    const minutes = Math.round(this.options.fallbackScanMs / 60_000)
    this.logger.warn(
      `Could not watch the folders of "${library.name}" (${reason(error)}); scanning it every ${minutes} min instead`,
    )
    watch.watchers.forEach((watcher) => watcher.close())
    watch.watchers = []
    watch.fallback = setInterval(() => this.scanner.scan(library.id), this.options.fallbackScanMs)
    watch.fallback.unref()
  }
}
