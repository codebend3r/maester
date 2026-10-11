import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { errorMessage } from '@/errorMessage'
import { type LibraryRecord, LibrariesRepository, samePaths } from '@/libraries/librariesRepository'
import type { WatchFolder, Watching } from '@/scanner/folderWatch'
import { ScannerService } from '@/scanner/scannerService'
import { isSkippedPlace } from '@/scanner/walk'

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

/** A library's folders watched, with the places changed since they were last looked at; or, failing that, a timer. */
type Watch =
  | {
      mode: 'watching'
      paths: readonly string[]
      watchers: Watching[]
      changed: Set<string>
      quiet: NodeJS.Timeout | null
    }
  | { mode: 'polling'; paths: readonly string[]; timer: NodeJS.Timeout }

/**
 * Refreshes each library that refreshes automatically as its folders
 * change. Changes gather until the folders have been still for a moment (a
 * copy in progress keeps them busy), then just the places that changed are
 * looked at again. A library whose folders cannot be watched (a share that
 * went away, or a system out of watches) is scanned on a timer instead, and
 * watched again once any library is saved.
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
      .filter(
        ([id, watch]) =>
          watch.mode === 'polling' ||
          !samePaths({ before: watch.paths, after: wanted.get(id)?.paths ?? [] }),
      )
      .forEach(([id]) => this.stop(id))
    Array.from(wanted.values())
      .filter((library) => !this.watches.has(library.id))
      .forEach((library) => this.start(library))
  }

  private start(library: LibraryRecord): void {
    const watch: Watch = {
      mode: 'watching',
      paths: library.paths,
      watchers: [],
      changed: new Set(),
      quiet: null,
    }
    this.watches.set(library.id, watch)
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

  private stop(libraryId: number): void {
    const watch = this.watches.get(libraryId)
    if (!watch) return
    switch (watch.mode) {
      case 'watching':
        watch.watchers.forEach((watcher) => watcher.close())
        if (watch.quiet) clearTimeout(watch.quiet)
        break
      case 'polling':
        clearInterval(watch.timer)
        break
      default: {
        const unknown: never = watch
        return unknown
      }
    }
    this.watches.delete(libraryId)
  }

  /** Hidden and NAS folders churn on their own; nothing in them is indexed. */
  private noteChange({ libraryId, root, path }: { libraryId: number; root: string; path: string }) {
    const watch = this.watches.get(libraryId)
    if (watch?.mode !== 'watching' || isSkippedPlace({ root, path })) return
    watch.changed.add(path)
    if (watch.quiet) clearTimeout(watch.quiet)
    watch.quiet = setTimeout(() => this.settle(libraryId), this.options.quietMs)
  }

  /** The folders have been still long enough: the places that changed are looked at again. */
  private settle(libraryId: number): void {
    const watch = this.watches.get(libraryId)
    if (watch?.mode !== 'watching') return
    watch.quiet = null
    this.scanner.refresh({ libraryId, places: [...watch.changed] })
    watch.changed.clear()
  }

  private fallBack({ library, error }: { library: LibraryRecord; error: unknown }): void {
    if (this.watches.get(library.id)?.mode !== 'watching') return
    const minutes = Math.round(this.options.fallbackScanMs / 60_000)
    this.logger.warn(
      `Could not watch the folders of "${library.name}" (${errorMessage(error)}); scanning it every ${minutes} min instead`,
    )
    this.stop(library.id)
    const timer = setInterval(() => this.scanner.scan(library.id), this.options.fallbackScanMs)
    timer.unref()
    this.watches.set(library.id, { mode: 'polling', paths: library.paths, timer })
  }
}
