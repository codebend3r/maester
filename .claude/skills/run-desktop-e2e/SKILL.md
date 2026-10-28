---
name: run-desktop-e2e
description: Use when running the `🎬 Desktop end to end` PR check locally on a Mac, or `desktop:e2e`: "run the desktop e2e", "run the Desktop end to end check locally", "run the Playwright tests for Raven", "the desktop e2e failed, run it here", "reproduce the desktop-playback job", "run ci:desktop:e2e". Covers the one command that runs the check, what it installs, its Nx caching, the traces and what appears on screen.
---

# Run the Desktop end to end check locally

The `🎬 Desktop end to end` leg of the `desktop-playback` job in `.github/workflows/pull-request-checks.yml`, on macOS with Apple silicon. One command runs every step, from the repo root:

```bash
bun run ci:desktop:e2e
```

It is `scripts/ci_desktop_e2e.sh`. Run it yourself in the background and report its steps as they print. Before starting, tell the user what will appear on screen (below).

The tests are Playwright driving `electron .` (the unpackaged app, never the packaged one) against fixture servers and a fake Supabase Auth they start themselves, so there is no server to start by hand.

## What it does

| Step               | What runs                                                                                                                                                                                                                  | Nx cached |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Tools              | Checks for Xcode (it cannot be installed from the shell, so the script stops and says so) and installs `ffmpeg` when missing                                                                                               | no        |
| Install            | `bun install --frozen-lockfile`                                                                                                                                                                                            | no        |
| libmpv             | Uses `libs/raven/mpv/resources/darwin-arm64` when the addon is there. Otherwise downloads CI's `raven-native-handoff-<sha>` (the addon, its dylibs and the source-built ffmpeg) from the newest run that has it, with `gh` | no        |
| Desktop end to end | `@raven/desktop:e2e`: its dependencies first (`@raven/web`'s and the desktop's `build`, cached, and `install:electron`), then `playwright test`, 48 tests one at a time                                                    | yes       |

It sets `DEVELOPER_DIR` (`/Applications/Xcode.app/Contents/Developer` unless set): `xcodebuild -version` is in the target's cache key and fails under the Command Line Tools that `xcode-select` points at. It sets `RAVEN_E2E_FFMPEG`, the ffmpeg that makes the test clips, to CI's source-built one when the handoff brought it, else Homebrew's.

The handoff lives one day. When no recent run has it, the script stops; the other way is `bun run mpv:native` (the full native toolchain in the `get-started` skill, and a long build), which is the user's to choose. When the branch changes `libs/raven/mpv/native`, the addon must come from that branch's own run: delete `libs/raven/mpv/resources/darwin-arm64` and let the script fetch it, or build it. `gh` must be signed in; if it is not, ask the user to run `! gh auth login`, never sign in for them.

## Caching

With the desktop, its dependencies' production files, the Xcode version and the architecture unchanged, a pass replays in seconds and no window opens. A failure is never cached. For a real run of a passing state, only when the user asks:

```bash
bun run ci:desktop:e2e -- --skip-nx-cache
```

## On screen

- A **Raven** window (an unpackaged Electron app, so the Dock shows Electron's icon) opens, does its test and closes, then the next one opens: dozens in a row, each coming to the front. Each runs on a throwaway profile, never `~/Library/Application Support/raven`.
- The windows show raven's web pages: sign-in against the fake Auth, the library, Downloads, On this Mac, Settings, the player's controls.
- No video picture and no sound: mpv runs headless and Chromium's audio output is off, so a playing title shows the player's controls over a blank stage.
- Ask the user not to click or type in the windows while it runs; a stolen focus or keypress can fail a test.
- The terminal prints Playwright's list reporter: each test with a pass or fail mark and its time.

## Afterwards

On a failure, report the failing tests and point at `apps/raven/desktop/test-results/` (what CI uploads as "End to end traces"). To replay one, with the user's say-so:

```bash
bunx playwright show-trace apps/raven/desktop/test-results/<test folder>/trace.zip
```

That opens Playwright's **Trace Viewer** as its own window, with the test's steps, screenshots and network calls.

## Common mistakes

- Running `playwright test` in `apps/raven/desktop`: it bypasses the Nx cache and the `build` and `install:electron` dependencies, so it can test a stale build. Go through `bun run ci:desktop:e2e`.
- A handoff from another PR when the branch changed the native addon: the tests load a stale addon.
