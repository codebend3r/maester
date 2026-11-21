# CI jobs: run times and Nx caching

How long each GitHub Actions job runs, slowest first, and whether Nx can restore its work from the remote cache (Nx Cloud) instead of running it.

The times are a snapshot: the 150 most recent completed workflow runs, 15 to 21 November 2026, counting successful jobs only, from the job's start to its end (time spent waiting for a runner is left out). A job that runs in both the pull request checks and the main native checks is one row. Measure again before leaning on a number; the release and cache jobs have only 2 to 8 runs each.

The "Nx cached" column describes the configuration as it stands in the repo, not what those 150 runs did: several rows were made cacheable after the measurement, so their times predate the cache.

| #   | Job                                       | Workflow                      | Avg     | Fastest | Slowest | Runs | Nx cached | What Nx restores                                                                         |
| --- | ----------------------------------------- | ----------------------------- | ------- | ------- | ------- | ---- | --------- | ---------------------------------------------------------------------------------------- |
| 1   | 📱 App on iPhone and iPad                 | PR checks, main native checks | 26m 00s | 14m 51s | 43m 06s | 57   | Yes       | The simulator build and the flows' pass                                                  |
| 2   | 📺 App on Android TV                      | PR checks, main native checks | 20m 35s | 18m 44s | 24m 34s | 57   | Yes       | The APK and the flows' pass                                                              |
| 3   | 🖥️ Build Raven for macOS arm64            | Desktop release               | 18m 45s | 18m 08s | 19m 54s | 3    | Partly    | The libmpv source build; the app is always made, signed, audited and smoke-tested afresh |
| 4   | 🎞️ Desktop native                         | PR checks, main native checks | 15m 28s | 10m 03s | 24m 46s | 70   | Mostly    | The libmpv source build and the native tests; the addon build and its audit always run   |
| 5   | 📺 App on Apple TV                        | PR checks, main native checks | 12m 32s | 7m 00s  | 22m 02s | 69   | Yes       | The simulator build and the remote flow's pass                                           |
| 6   | 📺 Build and attach the Android TV APK    | Device app release            | 9m 38s  | 8m 48s  | 10m 27s | 2    | Reruns    | The APK, on a rerun of the same tag; a new version always builds                         |
| 7   | 📺 Apple TV caches                        | App build caches              | 8m 15s  | 6m 24s  | 9m 51s  | 8    | No        | Nothing, on purpose (see below)                                                          |
| 8   | 📺 Android TV caches                      | App build caches              | 8m 09s  | 7m 07s  | 9m 15s  | 8    | No        | Nothing, on purpose (see below)                                                          |
| 9   | 📱 iPhone and iPad caches                 | App build caches              | 8m 00s  | 4m 41s  | 10m 35s | 8    | No        | Nothing, on purpose (see below)                                                          |
| 10  | 📱 App on Android phones                  | PR checks, main native checks | 7m 28s  | 6m 41s  | 8m 32s  | 5    | Yes       | The APK                                                                                  |
| 11  | 🪟 Build Raven for Windows x64            | Desktop release               | 5m 01s  | 4m 54s  | 5m 11s  | 3    | Partly    | The libmpv fetch, the addon, the native tests and the app's build; not the installer     |
| 12  | 🔦 Lighthouse                             | PR checks                     | 4m 31s  | 0m 31s  | 6m 19s  | 61   | Yes       | The pass, while the web app and the server are unchanged                                 |
| 13  | 🪟 Windows app                            | PR checks, main native checks | 4m 07s  | 2m 54s  | 5m 36s  | 75   | Partly    | The app's build; not the installer, its audit or its smoke test                          |
| 14  | 🧠 Evals                                  | Sparrow evals                 | 3m 05s  | 2m 49s  | 3m 29s  | 6    | Nightly   | The last pass, on the nightly run; a run from the Actions tab always runs                |
| 15  | 🎬 Desktop end to end                     | PR checks, main native checks | 3m 01s  | 0m 35s  | 6m 31s  | 65   | Yes       | The builds and the tests' pass                                                           |
| 16  | 🪟 Windows native                         | PR checks, main native checks | 2m 31s  | 1m 48s  | 4m 40s  | 79   | Yes       | The libmpv fetch, the addon, its audit and the native tests                              |
| 17  | 🧪 Tests                                  | PR checks                     | 2m 13s  | 0m 34s  | 4m 34s  | 66   | Yes       | Each project's pass                                                                      |
| 18  | 📦 Desktop app                            | PR checks, main native checks | 2m 04s  | 1m 23s  | 3m 15s  | 66   | Partly    | The app's build; not the packaged app, its audit or its smoke test                       |
| 19  | 🌐 Web end to end                         | PR checks                     | 1m 32s  | 0m 33s  | 2m 40s  | 62   | Yes       | The pass, while the web app and the server are unchanged                                 |
| 20  | 🧪 Desktop player against headless libmpv | PR checks, main native checks | 1m 18s  | 0m 30s  | 2m 06s  | 67   | Yes       | The tests' pass                                                                          |
| 21  | 🗄️ Supabase                               | PR checks                     | 1m 15s  | 0m 56s  | 2m 01s  | 70   | Yes       | The Edge Function checks, and the database tests and lint with the stack they start      |
| 22  | 📸 Screen tests                           | PR checks                     | 1m 06s  | 0m 20s  | 2m 13s  | 68   | Yes       | Each project's pass                                                                      |
| 23  | 🩺 raven build and health check           | PR checks, main smoke test    | 1m 01s  | 0m 45s  | 1m 35s  | 97   | No        | Nothing: a Docker image build and a health check, which run no Nx task                   |

Every other job averages under a minute. Of those, the lint, format, type-check, spellcheck, dead code, dead CSS, repository rule and build jobs are Nx cached; the sparrow and rookery smoke tests, the image publish, and the version and release jobs run no Nx task.

## Where the end to end tests run

The table above has one row per job, so only two suites show as rows of their own. The device app's suites are a step inside the job that builds the app, after the build, which is why those jobs are the slowest. The step times are from the same 150 runs.

| Suite                    | Job it runs in                               | Driven by                             | Nx target                   | Avg step | Share of its job |
| ------------------------ | -------------------------------------------- | ------------------------------------- | --------------------------- | -------- | ---------------- |
| Device app on Android TV | 📺 App on Android TV, step 🎬 App end to end | Maestro on an Android TV emulator     | `@raven/app:e2e:android-tv` | 11m 49s  | 57%              |
| Device app on iPhone     | 📱 App on iPhone and iPad, step 🎬 App end to end | Maestro on an iPhone simulator   | `@raven/app:e2e`            | 11m 40s  | 45%              |
| Raven on the desktop     | 🎬 Desktop end to end (its own job)          | Playwright driving Electron           | `@raven/desktop:e2e`        | 2m 22s   | 78%              |
| Device app on Apple TV   | 📺 App on Apple TV, step 🎬 Apple TV end to end | XCUITest on an Apple TV simulator  | `@raven/app:e2e:tvos`       | 2m 03s   | 16%              |
| raven on the web         | 🌐 Web end to end (its own job)              | Playwright in Google Chrome           | `@raven/web:e2e:browser`    | 0m 50s   | 54%              |
| Wren on iPhone           | 🎵 Wren on iPhone, step 🎬 Wren end to end   | Maestro on an iPhone simulator        | `@raven/music:e2e`          | no runs  | no runs          |

- The Android TV step's time includes booting the emulator, since one action boots it and runs the flows.
- Wren's two jobs (🎵 Wren on iPhone and 🎵 Wren for Android) run whenever a change touches Wren. They were still switched off in every one of those runs, so they have no times and no row above.
- Android phones, Raven on Windows and Wren on the web have no end to end suite in CI: the first two jobs build and smoke-test only, and `@raven/music-web` has no e2e target.

## What is not cached, and why

- **The app build caches (rows 7 to 9).** These jobs exist to compile on main and save ccache's, Gradle's and CocoaPods' caches for every pull request to restore. A build restored from Nx would compile nothing and save empty caches, so they pass `--skip-nx-cache`.
- **Packaging (rows 3, 11, 13 and 18).** `make`, `audit:bundle`, `smoke:packaged` and `release:assets` are `cache: false`. They package the native pieces another job hands over as an artifact, which Nx does not hash, so a cached installer could hold stale binaries; a release must also be signed and smoke-tested as built.
- **The addon build and its audit (row 4).** `build:native` and `audit:native` take about 11 seconds each and write into the folder the libmpv build owns, so they run every time.
- **The Docker smoke tests (row 23).** They build each product's image and ask its health route. Nothing in them is an Nx task.

## What a cache hit needs

- **The token.** A job reads and writes the remote cache only when its `env` carries `NX_CLOUD_ACCESS_TOKEN`. Without it Nx Cloud answers 401 and the job runs everything, which is also what a fork's pull request does. Nx Cloud counts the jobs connected at once, so a job that gains nothing from the cache should not carry it.
- **Small outputs.** A cached target stores only what later steps read: the simulator app and the pod lockfiles for an Apple build, the `apk/release` folder for an Android one. Whole `Pods`, `DerivedData` or `android` folders are gigabytes and have failed to upload.
- **No link out of an output.** Nx refuses to restore an output holding a symlink that points outside it, and runs the task instead. The libmpv build copies MoltenVK's headers as files for that reason.
- **Honest inputs.** A target whose result depends on another project names that project's sources, as `e2e:browser` and `lighthouse` name the server's. A result that depends on an environment variable or a tool's version names it as an `env` or `runtime` input.
