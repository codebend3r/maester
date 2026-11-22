# CI jobs: run times and Nx caching

How long each GitHub Actions job runs, slowest first, and whether Nx can restore its work from the remote cache (Nx Cloud) instead of running it.

The times are a snapshot: the 150 most recent completed workflow runs, 15 to 21 November 2026, counting successful jobs only, from the job's start to its end (time spent waiting for a runner is left out). A job that runs in both the pull request checks and the native checks is one row. Measure again before leaning on a number; the release and cache jobs have only 2 to 8 runs each, and Wren's two jobs one each.

The "Nx cached" column describes the configuration as it stands in the repo, not what those 150 runs did: several rows were made cacheable after the measurement, so their times predate the cache.

Rows 1, 2, 3 and 6 were measured with each job building the app and running its flows in one. The flows run in an end to end job of their own (see below), so each of those times spans two jobs: the build job (🏗️ Build and the device) and its end to end job (🎬 E2E and the device). Every row carries its job's current name. The end to end jobs have no measured run, so they have no row; the last table below lists them.

| # | Job | Workflow | Avg | Fastest | Slowest | Runs | Nx cached | What Nx restores |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 🏗️ Build Wren iPhone | PR checks, native checks | 32m 41s | 32m 41s | 32m 41s | 1 | Yes | The simulator build; the flows' pass, in its end to end job |
| 2 | 🏗️ Build iPhone | PR checks, native checks | 25m 59s | 8m 14s | 43m 06s | 57 | Yes | The simulator build; the flows' pass, in its end to end job |
| 3 | 🏗️ Build Android TV | PR checks, native checks | 20m 14s | 14m 45s | 24m 34s | 57 | Yes | The APK; the flows' pass, in its end to end job |
| 4 | 🖥️ Build Raven for macOS arm64 | Desktop release | 19m 04s | 18m 14s | 19m 54s | 2 | Partly | The libmpv source build; the app is always made, signed, audited and smoke-tested afresh |
| 5 | 🏗️ Build Mac native | PR checks, native checks | 14m 48s | 1m 55s | 24m 46s | 72 | Mostly | The libmpv source build and the native tests; the addon build and its audit always run |
| 6 | 🏗️ Build Apple TV | PR checks, native checks | 12m 19s | 2m 50s | 22m 02s | 70 | Yes | The simulator build; the remote flow's pass, in its end to end job |
| 7 | 📺 Build and attach the Android TV APK | Device app release | 9m 37s | 8m 48s | 10m 27s | 2 | Reruns | The APK, on a rerun of the same tag; a new version always builds |
| 8 | 📱 iPhone and iPad caches | App build caches | 9m 25s | 4m 41s | 19m 51s | 8 | No | Nothing, on purpose (see below) |
| 9 | 🏗️ Build Wren Android | PR checks, native checks | 9m 21s | 9m 21s | 9m 21s | 1 | Yes | The Release APK |
| 10 | 📺 Apple TV caches | App build caches | 9m 12s | 6m 24s | 14m 10s | 8 | No | Nothing, on purpose (see below) |
| 11 | 📺 Android TV caches | App build caches | 8m 16s | 7m 07s | 9m 17s | 8 | No | Nothing, on purpose (see below) |
| 12 | 🏗️ Build Android phone | PR checks, native checks | 5m 42s | 1m 36s | 8m 35s | 13 | Yes | The APK |
| 13 | 🪟 Build Raven for Windows x64 | Desktop release | 5m 04s | 4m 58s | 5m 11s | 2 | Partly | The libmpv fetch, the addon, the native tests and the app's build; not the installer |
| 14 | 🔦 Lighthouse | PR checks | 4m 13s | 0m 31s | 6m 19s | 66 | Yes | The pass, while the web app and the server are unchanged |
| 15 | 🏗️ Build Windows app | PR checks, native checks | 4m 07s | 2m 54s | 5m 36s | 76 | Partly | The app's build; not the installer, its audit or its smoke test |
| 16 | 🧠 Evals | Sparrow evals | 3m 05s | 2m 49s | 3m 29s | 7 | Nightly | The last pass, on the nightly run; a run from the Actions tab always runs |
| 17 | 🎬 E2E Mac | Native checks | 3m 00s | 0m 35s | 6m 07s | 65 | Yes | The builds and the tests' pass |
| 18 | 🏗️ Build Windows native | PR checks, native checks | 2m 31s | 1m 48s | 4m 40s | 80 | Yes | The libmpv fetch, the addon, its audit and the native tests |
| 19 | 🧪 Tests | PR checks | 2m 07s | 0m 34s | 4m 34s | 71 | Yes | Each project's pass |
| 20 | 🏗️ Build Mac app | PR checks, native checks | 2m 05s | 1m 23s | 3m 15s | 67 | Partly | The app's build; not the packaged app, its audit or its smoke test |
| 21 | 🌐 Web end to end | Native checks | 1m 30s | 0m 33s | 2m 40s | 67 | Yes | The pass, while the web app and the server are unchanged |
| 22 | 🧪 Test Mac player | PR checks, native checks | 1m 17s | 0m 30s | 2m 06s | 67 | Yes | The tests' pass |
| 23 | 🗄️ Supabase | PR checks | 1m 11s | 0m 23s | 2m 01s | 76 | Yes | The Edge Function checks, and the database tests and lint with the stack they start |
| 24 | 📸 Screen tests | Native checks | 1m 06s | 0m 20s | 2m 13s | 73 | Yes | Each project's pass |
| 25 | 🩺 raven build and health check | PR checks, main smoke test | 1m 00s | 0m 45s | 1m 35s | 101 | No | Nothing: a Docker image build and a health check, which run no Nx task |
| 26 | 📦 Publish raven | Main smoke test | 1m 00s | 0m 44s | 1m 37s | 25 | No | Nothing: an image publish, which runs no Nx task |

Every other job averages under a minute. Of those, the lint, format, type-check, spellcheck, dead code, dead CSS, repository rule and build jobs are Nx cached; the sparrow and rookery smoke tests and the version and release jobs run no Nx task.

## Where the end to end tests run

No end to end suite runs on a pull request. A pull request's checks build each native app and upload the build as an artifact named for its head commit, so it hears back sooner; the push to main that merges it runs the suites (`native-checks.yml`, the only workflow that holds an end to end job). There, 🔎 Select affected native checks (the same job a pull request runs, through the `raven-native-select` action) looks up the merged pull request's passing checks run (`scripts/find_pr_builds.sh`) and plans each group once (`scripts/plan_native_builds.sh`): whether the push selected it, whether to build it, and which run holds its builds. The end to end jobs download the pull request's builds, so main compiles nothing it was already handed. A group with no build to find (a push with no pull request, a manual run, an expired artifact, a group the pull request never built) is built on main first. An end to end failure therefore shows after the merge, on main, where it emails the pusher. On main a build job runs only as that fallback.

Every suite runs in a job of its own. The device app's and Wren's run after the job that builds the app, on a second runner: the build job uploads the build as an artifact (the simulator app, or the APK; the Apple TV's also uploads the Xcode project and the remote test target), and the end to end job downloads it, boots the simulator or emulator, starts the fixture server and runs the flows. It sets up through the same `raven-app-setup` action with `compiles: false`, which leaves out the CocoaPods, Gradle and ccache caches and the NDK. A failed build skips its end to end job.

The step times are from the same 150 runs, which ran the device app's and Wren's suites as a step of the build job, and the share is of that joined job. Wren's is from its one run.

| Suite                    | Job it runs in                               | Driven by                             | Nx target                   | Avg step | Share of the joined job |
| ------------------------ | -------------------------------------------- | ------------------------------------- | --------------------------- | -------- | ---------------- |
| Device app on Android TV | 🎬 E2E Android TV, after 🏗️ Build Android TV | Maestro on an Android TV emulator     | `@raven/app:e2e:android-tv` | 11m 51s  | 59%              |
| Device app on iPhone     | 🎬 E2E iPhone, after 🏗️ Build iPhone | Maestro on an iPhone simulator   | `@raven/app:e2e`            | 11m 41s  | 45%              |
| Raven on the desktop     | 🎬 E2E Mac (its own job)          | Playwright driving Electron           | `@raven/desktop:e2e`        | 2m 21s   | 78%              |
| Device app on Apple TV   | 🎬 E2E Apple TV, after 🏗️ Build Apple TV | XCUITest on an Apple TV simulator  | `@raven/app:e2e:tvos`       | 1m 58s   | 16%              |
| raven on the web         | 🌐 Web end to end (its own job)              | Playwright in Google Chrome           | `@raven/web:e2e:browser`    | 0m 47s   | 53%              |
| Wren on iPhone           | 🎬 E2E Wren iPhone, after 🏗️ Build Wren iPhone | Maestro on an iPhone simulator        | `@raven/music:e2e`          | 4m 45s   | 15%              |

- The Android TV step's time includes booting the emulator, since one action boots it and runs the flows.
- Wren's jobs (🏗️ Build Wren iPhone, its 🎬 E2E Wren iPhone, and 🏗️ Build Wren Android) run whenever a change touches Wren. The two build jobs ran once in those runs.
- Android phones, Raven on Windows and Wren on the web have no end to end suite in CI: the first two jobs build and smoke-test only, and `@raven/music-web` has no e2e target.

The native workflow has no matrix: each device is a build job named for it (`build-iphone`) and, where it has flows, an end to end job (`e2e-iphone`) that waits for that build alone, so one slow device never holds another's flows. What a device needs is its job's `APP_*` variables; the builds share one list of steps, and the end to end jobs share theirs. 🔦 Lighthouse is a job of its own beside the checks matrix, so the build and the native jobs never wait for it.

The four end to end jobs that follow a build have no measured run yet:

| Job | Waits for | Nx cached | What Nx restores |
| --- | --- | --- | --- |
| 🎬 E2E iPhone | 🏗️ Build iPhone | Yes | The flows' pass, while the app and the server are unchanged |
| 🎬 E2E Android TV | 🏗️ Build Android TV | Yes | The flows' pass, while the app and the server are unchanged |
| 🎬 E2E Apple TV | 🏗️ Build Apple TV | Yes | The remote flow's pass, while the app and the server are unchanged |
| 🎬 E2E Wren iPhone | 🏗️ Build Wren iPhone | Yes | The flows' pass, while the app and the server are unchanged |

## What is not cached, and why

- **The app build caches (rows 8, 10 and 11, and Wren's iPhone and Android legs, which have no times yet).** These jobs exist to compile on main and save ccache's, Gradle's and CocoaPods' caches for every pull request to restore, one leg for each app and platform a pull request builds, each saved under its app's own keys. A build restored from Nx would compile nothing and save empty caches, so they pass `--skip-nx-cache`. ccache reads paths under the checkout as relative, so an app with no cache of its own yet falls back to the other app's for the sources the two share.
- **Packaging (rows 4, 13, 15 and 20).** `make`, `audit:bundle`, `smoke:packaged` and `release:assets` are `cache: false`. They package the native pieces another job hands over as an artifact, which Nx does not hash, so a cached installer could hold stale binaries; a release must also be signed and smoke-tested as built.
- **The addon build and its audit (row 5).** `build:native` and `audit:native` take about 11 seconds each and write into the folder the libmpv build owns, so they run every time.
- **The Docker smoke tests (row 25).** They build each product's image and ask its health route. Nothing in them is an Nx task.

## What a cache hit needs

- **The token.** A job reads and writes the remote cache only when its `env` carries `NX_CLOUD_ACCESS_TOKEN`. Without it Nx Cloud answers 401 and the job runs everything, which is also what a fork's pull request does. `pull-request-checks.yml` and `native-checks.yml` set it once in their top-level `env`, so every job carries it, and `test_native_ci.py` fails when a job sets it again or goes without.
- **Small outputs.** A cached target stores only what later steps read: the simulator app and the pod lockfiles for an Apple build, the `apk/release` folder for an Android one. Whole `Pods`, `DerivedData` or `android` folders are gigabytes and have failed to upload.
- **No link out of an output.** Nx refuses to restore an output holding a symlink that points outside it, and runs the task instead. The libmpv build copies MoltenVK's headers as files for that reason.
- **Honest inputs.** A target whose result depends on another project names that project's sources, as `e2e:browser` and `lighthouse` name the server's. A result that depends on an environment variable or a tool's version names it as an `env` or `runtime` input.
