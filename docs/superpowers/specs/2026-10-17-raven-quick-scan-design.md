# raven's quick scan: full scans only on demand

Date: 2026-10-17. Status: approved by the user in conversation; built in one
PR on `library-update-logic`.

## Why

On Vhagar every library was being fully scanned every 10 minutes. Nothing in
the config asked for it: `RESCAN_INTERVAL_MINUTES` is 0 there. The cause is
the folder watcher's fallback:

- `LibraryWatcher` puts one inotify watch on every folder of every library
  that refreshes automatically. The container runs out of watches partway
  through each library (`ENOSPC: System limit for number of file watchers
  reached`), logs "scanning it every 10 min instead", and falls back to a
  timer that runs a **full** scan.
- All 13 libraries hit that, so all 13 were fully scanned every 10 minutes.
  The Libraries page read "Scanned 9 min ago" on every row, with a progress
  bar on whichever was mid-scan.
- Even with enough watches, inotify would not help: most of the libraries
  are shares mounted from meleys, vermithor, caraxes and syrax, and inotify
  never reports a change made on another machine. Only Vhagar's own paths
  could ever be watched.
- The "Scanned ... ago" time lived in memory, so every restart lost it and
  the boot scan reset it.

## Goals

1. A full scan runs only when asked for: **Rescan**, a new library, or a
   change of a library's folders. Never on a timer, and not on boot.
2. New media turns up on its own, through a **quick scan** that costs a
   fraction of a full scan and never takes over the library's scan status.
3. Each library says when it was last fully scanned and last quick-scanned,
   and both times survive a restart.

Non-goals: watching network shares (impossible), a smarter walker that skips
unchanged folders, or a quick scan button in the UI. Anti-goal: a quick scan
that misses a newly added, renamed or deleted file.

## What a quick scan is

A quick scan walks every folder of the library, as a full scan does, but
stats only the files it does not know. A file already in the index keeps the
size and modification time the index holds, so it counts as unchanged: it is
neither stat'ed nor probed. Everything else works as in a full scan:

- a new file is added, probed and handed to thumbnails and matching;
- a renamed or moved file is followed (its size and mtime match a file that
  went missing);
- a deleted file is dropped;
- a file whose probe timed out earlier is probed again.

What it cannot see: a file overwritten in place under the same name. That
needs its size or mtime, which a quick scan does not read. A full scan finds
it.

Cost: one `readdir` per folder, one `stat` per new file. A full scan is one
`readdir` per folder plus one `stat` per file. On Vhagar's TV Shows (34,192
files) that is roughly a tenth of the filesystem calls.

The quick scan does not touch `library_paths.layout`, which keeps saying what
the last full scan read.

## Design

### Server

**Scopes** (`scannerService.ts`). The scan scope becomes

```ts
type Scope =
  | { kind: 'library' }
  | { kind: 'quick'; places: readonly string[] }
  | { kind: 'places'; places: readonly string[] }
```

A quick scan carries `places` where files are stat'ed anyway, so a watcher
refresh that merges into a waiting quick scan keeps its ability to see a
replaced file. Merging two waiting scopes:

| waiting | new | result |
| --- | --- | --- |
| library | anything | library |
| anything | library | library |
| quick | quick or places | quick, places joined |
| places | quick | quick, places joined |
| places | places | places joined |

`mergeScopes` is exported for its test. `inScope` treats a quick scan like
a full one: it speaks for every indexed path of the library, except under
paths that could not be read.

**Walker** (`walk.ts`). `walkVideos` takes an optional
`known: (path: string) => { size: number; mtimeMs: number } | null`. When it
returns a value, that is the file's size and mtime and no `stat` is made.
The scanner passes, for a quick scope, a lookup over the index's files that
answers null under any of the scope's places.

**Running a quick scan.** `ScannerService.quickScan(libraryId)` queues
`{ kind: 'quick', places: [] }`. `runQuick` reindexes with the lookup above,
enqueues matching and probes what is new, like `refreshPlaces` does, and
then records the time: `libraries.markQuickScan({ id, at })` and the
in-memory status's `quickScannedAt`. It logs
`Quick scan of "X": N files, A added, M moved, P probed, R removed`. A
failure is logged as a warning; the status's `error` stays the full scan's.

`scanAll` goes; `quickScanAll` takes its place and runs on
`onApplicationBootstrap` when `scanOnStart` is set, over every library, and
on the timer over libraries that refresh automatically.

**Persisted times.** Migration 26:

```sql
ALTER TABLE libraries ADD COLUMN full_scanned_at TEXT;
ALTER TABLE libraries ADD COLUMN quick_scanned_at TEXT;
```

`LibraryRecord` gains `fullScannedAt: string | null` and
`quickScannedAt: string | null`. `LibrariesRepository` gains
`markFullScan({ id, at })` and `markQuickScan({ id, at })`. `scanLibrary`
calls `markFullScan` when it finishes, whether or not it failed, as it sets
`finishedAt` today.

`ScannerService.status(id)` seeds an idle status from the record when
nothing is in memory: `finishedAt` from `fullScannedAt`, `quickScannedAt`
from `quickScannedAt`. So after a restart the Libraries page still says when
each library was scanned.

**Config.** `RESCAN_INTERVAL_MINUTES` goes. `QUICK_SCAN_INTERVAL_MINUTES`
arrives, default 10, 0 off. `SCAN_ON_START` stays, and now means a quick
scan of every library on boot. Both compose files and the README's table
change with it.

**Watcher.** `LibraryWatcher` keeps watching where it can; the quick scan
timer runs regardless, so a library on a network share is covered either
way. When a watch fails, the library goes to an `unwatched` mode that holds
no timer: it logs "Could not watch the folders of X (...); its quick scan
will find the changes", and is watched again the next time a library is
saved, as today. `WatchOptions.fallbackScanMs` goes.

### Contract

`isScanStatus` gains `quickScannedAt: nullable(isString)`, "when the last
quick scan finished, or null before any". `finishedAt`'s comment says it is
the last full scan's end, kept across restarts.

### Web

`ScanStatus`, when idle, shows both times on one row:

```
Full scan 2 h ago · Quick scan 4 min ago
```

Each is its own `span` in a `grid-auto-flow: column` row with a gap. With
no full scan on record but a quick scan, the first reads `No full scan
yet`, so a library upgraded from before this change explains itself until
its first Rescan. With neither, the row is left out, as today.

`LibraryDialog`'s Refresh automatically hint changes to: "Watch the folders
and take in videos as they are added, removed, renamed or replaced. A share
that does not report its changes gets a quick scan every few minutes
instead. A video replaced under the same name needs a rescan."

### Docs

README: the Refresh automatically paragraph, a new sentence under the
scanning notes, and the configuration table. `.env.example` is unchanged
(it never listed the scan settings).

## Testing

- **Server**
  - `walk.test.ts`: a known file takes its size and mtime from `known` and
    is not stat'ed; an unknown one is stat'ed.
  - `scannerService.test.ts` (new): `mergeScopes` table.
  - `appQuickScan.test.ts` (new): over a temp tree, a full scan, then a
    file added, one renamed and one deleted; a quick scan brings the index
    in line, sets `quickScannedAt`, and leaves `finishedAt` as the full
    scan left it. A file overwritten in place is not re-probed by a quick
    scan but is by a full one. The times survive a second app over the same
    data dir.
  - `appWatching.test.ts`: the unwatched library is picked up by a quick
    scan, called directly rather than waited for.
  - `database.test.ts`: migration 26 gives an existing library null times.
  - `config.test.ts`: `QUICK_SCAN_INTERVAL_MINUTES` defaults to 10.
- **Web**
  - `ScanStatus.test.tsx`: both times; no full scan yet; nothing when
    neither.
- **On Vhagar**: after deploy, the log shows no "Scanned" lines except after
  Rescan, "Quick scan of" lines every 10 minutes, and the Libraries page
  shows both times.
