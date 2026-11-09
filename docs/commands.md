<!-- Written by scripts/help.py --markdown from its GROUPS; edit them, never this file. -->

# Commands

Every script in the root `package.json`, grouped. Run any of them from the repo root with `bun run <command>`; `bun run help` prints the same list in the terminal, and [Pull request checks, locally](ci-commands.md) explains the `ci:*` commands. The Needs column names what a command needs beyond Bun, uv and ffmpeg.

## Everyday checks

What to run before a push; the pre-push hook runs the same checks.

| Command           | What it does                                                                                                                                                | Needs |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `verify`          | Every check at once: spelling, TypeScript only, one command per script, dead code and CSS, lint, format, typecheck, unit and screen tests, and every build. |       |
| `verify:uncached` | verify, ignoring Nx's cache, after a toolchain change.                                                                                                      |       |
| `affected`        | The repo-wide checks, then lint, format, typecheck, tests and builds only for the projects your branch changed.                                             |       |
| `affected:tasks`  | The per-project half of affected, without the repo-wide checks.                                                                                             |       |
| `build`           | Builds every project.                                                                                                                                       |       |
| `test`            | Every project's unit tests.                                                                                                                                 |       |
| `test:screens`    | The device app's render tests under jest-expo.                                                                                                              |       |
| `typecheck`       | Typechecks every TypeScript project.                                                                                                                        |       |

## Lint and format

Style and static checks across Python, TypeScript and SCSS.

| Command        | What it does                                                          | Needs |
| -------------- | --------------------------------------------------------------------- | ----- |
| `lint`         | Lints Python (ruff), TypeScript (oxlint) and SCSS (gale).             |       |
| `lint:py`      | Lints the Python with sparrow's pinned ruff.                          |       |
| `lint:ts`      | Lints the TypeScript with oxlint.                                     |       |
| `lint:css`     | Lints the SCSS with gale.                                             |       |
| `lint:fix`     | Fixes what the three linters can fix on their own.                    |       |
| `format`       | Formats every project (oxfmt, ruff format).                           |       |
| `format:check` | Fails on any file the formatters would change.                        |       |
| `lint-staged`  | Lints and formats only the staged files, as the pre-commit hook does. |       |

## Repo rules

Workspace-wide checks for rules no linter covers.

| Command                  | What it does                                                                                           | Needs       |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ----------- |
| `spellcheck`             | Spellchecks the repo with typos.                                                                       |             |
| `typescript-only`        | Fails on any .js, .jsx, .mjs or .cjs file.                                                             |             |
| `one-command-per-script` | Fails on a package.json script chained with &&, \|\| or ;.                                             |             |
| `comment-style`          | Fails on stacked // comment lines in TypeScript or SCSS.                                               |             |
| `dead-code`              | Finds unused exports, files and dependencies with knip.                                                |             |
| `dead-css`               | Finds SCSS module classes no component reads.                                                          |             |
| `claude-audit`           | Has Claude Code read your unpushed commits against the CLAUDE.md files for the rules no linter checks. | Claude Code |
| `graph`                  | Opens Nx's interactive project graph in the browser.                                                   |             |

## Dev servers

Run a product locally; each reads the .env beside its compose file.

| Command                | What it does                                                                                                                     | Needs  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `dev:raven`            | raven's server, shared UI and web app, with hot reload.                                                                          |        |
| `dev:raven:prod`       | raven's web app and UI against the live server on Vhagar, with no local server.                                                  |        |
| `dev:raven:vhagar`     | raven's web app and UI against Vhagar over the home network, playing straight from it. The fastest way to load and play at home. | Vhagar |
| `dev:raven:db`         | Replaces the local raven database with a copy of Vhagar's, paths rewritten to this Mac's mounts. Stop the dev server first.      | Vhagar |
| `dev:raven:splash`     | raven's splash page (maester.netlify.app) with hot reload.                                                                       |        |
| `web:build`            | Builds raven's web app, as Netlify and the desktop app ship it.                                                                  |        |
| `build:raven:splash`   | Builds raven's splash page.                                                                                                      |        |
| `preview:raven:splash` | Serves the built splash page, as Netlify would.                                                                                  |        |
| `dev:sparrow`          | sparrow's API and chat page.                                                                                                     |        |
| `sandbox:sparrow`      | sparrow's sandbox for testing its answers.                                                                                       |        |
| `dev:rookery`          | rookery's sign-in server and its login pages.                                                                                    |        |

## raven device app

Expo on react-native-tvos: iPhone, iPad, Apple TV and Android TV.

| Command                   | What it does                                                                    | Needs       |
| ------------------------- | ------------------------------------------------------------------------------- | ----------- |
| `app:start`               | Starts Metro for a dev client.                                                  | watchman    |
| `app:server`              | raven's dev server, for the app to talk to.                                     |             |
| `app:dev:ios`             | A Debug build on the iPhone simulator, against Metro.                           | Xcode       |
| `app:dev:ipad`            | A Debug build on the iPad simulator, against Metro.                             | Xcode       |
| `app:dev:tvos`            | A Debug build on the Apple TV simulator, against Metro.                         | Xcode       |
| `app:prebuild:ios`        | Generates the iPhone and iPad native project and its pods.                      | Xcode       |
| `app:prebuild:tvos`       | Generates the Apple TV native project and its pods.                             | Xcode       |
| `app:prebuild:android-tv` | Generates the Android TV native project.                                        | Android SDK |
| `app:build:ios`           | A Release build for the iPhone simulator.                                       | Xcode       |
| `app:build:tvos`          | A Release build for the Apple TV simulator.                                     | Xcode       |
| `app:build:android-tv`    | A Release APK for Android TV, to install on the emulator or a TV.               | Android SDK |
| `app:deploy:tvos`         | Builds the signed Release and puts it on the paired Apple TV.                   | Xcode       |
| `app:deploy:android-tv`   | Builds the Release APK and puts it on the Android TV over adb, found over mDNS. | Android SDK |
| `app:deploy:tvs`          | Puts the checked-out app on the Android TV, then on the Apple TV.               | Xcode       |
| `app:e2e`                 | The Maestro flows on the iPhone simulator, against the fixture server.          | Maestro     |
| `app:e2e:tvos`            | The Siri Remote XCUITest on the Apple TV simulator.                             | Xcode       |
| `app:e2e:android-tv`      | The Maestro flows on the Android TV emulator, driven by the remote.             | emulator    |

## Raven desktop

The Electron app on macOS and Windows, with libmpv.

| Command                  | What it does                                                                                                 | Needs         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------- |
| `desktop:dev`            | Raven in Electron with the web app's dev build.                                                              | macOS         |
| `desktop:build`          | Builds Raven's main process, preload and web app.                                                            |               |
| `desktop:test:native`    | The libmpv player's native tests.                                                                            | macOS         |
| `desktop:e2e`            | Playwright drives the real pages against a fixture server.                                                   | macOS         |
| `desktop:make`           | Packages Raven: the dmg and zip, or Squirrel's installer on Windows.                                         |               |
| `desktop:audit:bundle`   | Checks the packaged engine's binaries and their imports.                                                     |               |
| `desktop:smoke:packaged` | Launches the packaged app and checks it starts and quits. Uses your own ~/Library/Application Support/raven. | macOS         |
| `desktop:release:assets` | Names and gathers the release's files for upload.                                                            |               |
| `mpv:native`             | Builds the pinned libmpv and the addon, then runs its audit and native tests.                                | macOS + Xcode |
| `mpv:native:windows`     | The Windows addon's audit and native tests against the pinned libmpv DLL.                                    | Windows       |

## Pull request checks, locally

Each runs one CI job from pull-request-checks.yml on this machine.

| Command                           | What it does                                                                       | Needs           |
| --------------------------------- | ---------------------------------------------------------------------------------- | --------------- |
| `ci:docker`                       | The ✅ Checks job inside an Ubuntu 24.04 container.                                | Docker          |
| `ci:app:ios`                      | The 📱 App on iPhone and iPad job: every ci:app:ios step below, in order.          | macOS + Xcode   |
| `ci:app:ios:tools`                | Its tools: Homebrew's, Maestro and the iOS simulator runtime.                      | macOS + Xcode   |
| `ci:app:ios:simulator`            | Boots the raven-phone iPhone simulator, making it when there is none.              | macOS + Xcode   |
| `ci:app:ios:build`                | The fixture's Release build for the iPhone simulator.                              | macOS + Xcode   |
| `ci:app:ios:pods`                 | Checks the build's pod install finished.                                           | macOS + Xcode   |
| `ci:app:ios:install`              | Installs the build on the iPhone simulator.                                        | macOS + Xcode   |
| `ci:app:ios:e2e`                  | The touch Maestro flows on the iPhone simulator.                                   | macOS + Xcode   |
| `ci:app:tvos`                     | The 📺 App on Apple TV job.                                                        | macOS + Xcode   |
| `ci:app:android-tv`               | The 📺 App on Android TV job: every ci:app:android-tv step below, in order.        | Android SDK     |
| `ci:app:android-tv:tools`         | Its tools: Android Studio, the SDK, the TV system image and Maestro.               | Android SDK     |
| `ci:app:android-tv:emulator`      | Starts the raven_tv emulator, making it when there is none.                        | Android SDK     |
| `ci:app:android-tv:build`         | The fixture's Release APK for the emulator.                                        | Android SDK     |
| `ci:app:android-tv:emulator:wait` | Waits for the emulator to boot and turns its animations off.                       | Android SDK     |
| `ci:app:android-tv:install`       | Installs the APK on the emulator.                                                  | Android SDK     |
| `ci:app:android-tv:e2e`           | The remote's Maestro flows on the emulator.                                        | Android SDK     |
| `ci:app:install`                  | The device app jobs' bun install.                                                  |                 |
| `ci:app:libraries`                | Builds the libraries the fixture server and the device app read.                   |                 |
| `ci:app:fixture`                  | The device app jobs' fixture server on :8490, in the foreground.                   | ffmpeg          |
| `ci:app:fixture:wait`             | Waits up to three minutes for the fixture server to answer.                        |                 |
| `ci:wren`                         | The 🎵 Wren on iPhone job.                                                         | macOS + Xcode   |
| `ci:desktop:e2e`                  | The 🎬 Desktop end to end job.                                                     | macOS           |
| `web:e2e`                         | The 🌐 Web end to end job: Playwright drives the web app against a fixture server. | Chrome + ffmpeg |

## Help

This list.

| Command | What it does                                     | Needs |
| ------- | ------------------------------------------------ | ----- |
| `help`  | Lists every command, grouped, with what it does. |       |
