---
name: stack-plan
description: Use when asked where the stacked PRs stand, "show the plan", "stack status", "what's next in the stack", "/stack-plan", or before starting the next PR of the Windows port. Holds the plan the stack was built from (scope, order, model, effort, estimates, constraints) and reports it as one table with each PR's live state from GitHub.
---

# Stack plan

The plan behind the open stack on `main`, kept here so a new session can pick the work
up without the thread that made it. Run it to print the table below with each row's
live state. Update the rows here when the plan changes, never only in chat.

## The stack

Bottom to top. Each branch is cut from the one below it and its PR's base is that
branch. After a bottom PR merges, the rest restack with `rebase-stack`.

| #   | PR           | Branch                    | Base                      | Scope                                                                                                                                                                                                                           | Model      | Effort | Work estimate |
| --- | ------------ | ------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ------------- |
| T   | #298 to #304 | `thermo-*`                | `main`                    | The second whole-repo thermo-nuclear review, seven PRs                                                                                                                                                                          | Opus 5.5   | medium | done          |
| 1   | #306         | `raven-splash`            | `thermo-rookery-luwin`    | raven's front door at `maester.netlify.app`: download menu from the GitHub releases API, link to the web app, `/releases/` versions page                                                                                        | Opus 5.5   | medium | 2.5 h (spent) |
| 2   | #307         | `raven-windows-libmpv`    | `raven-splash`            | Windows port 1 of 6: pinned prebuilt `libmpv-2.dll` under `resources/win32-x64`, a PE audit in TypeScript, the `🪟 Windows native` CI job                                                                                       | Opus 5.5   | medium | 1.5 h (spent) |
| 3   | #308         | `raven-windows-addon`     | `raven-windows-libmpv`    | Windows port 2 of 6: `addon.cpp` shared, `surface_mac.mm` and `surface_win.cpp`, CMake for MSVC with an import library from the DLL's export list, `nativeTargetOf`, headless native tests on Windows                           | Opus 5.5   | high   | 5 to 7 h      |
| 4   | #309         | `raven-windows-window`    | `raven-windows-addon`     | Windows port 3 of 6: transparent frameless window on Windows, page transparent only while mpv plays, Raven's own title bar (minimize, maximize, close) over the bridge                                                          | Opus 5.5   | medium | 3 to 4 h      |
| 5   | #312         | `raven-windows-main`      | `raven-windows-window`    | Windows port 4 of 6: `wasapi` audio, engine path by platform, Windows menus, `second-instance` opens, `raven://` registration, logs in `%APPDATA%`, update asset per platform, platform copy ("On this Mac" reads "On this PC") | Opus 5.5   | medium | 2 to 3 h      |
| 6   | #314         | `raven-windows-packaging` | `raven-windows-main`      | Windows port 5 of 6: `stage:mpv` by platform, a Windows installer maker, `bundleAudit` for PE files, `releaseAssets` adds the setup `.exe` (unsigned)                                                                           | Opus 5.5   | high   | 4 to 5 h      |
| 7   | #315         | `raven-windows-ci`        | `raven-windows-packaging` | Windows port 6 of 6: the Windows jobs run `make`, the audit and the smoke on top of the native tests (e2e stays macOS-only), a Windows build in `desktop-release.yml`, Windows notes in `CLAUDE.md` and the desktop spec        | Sonnet 5.5 | medium | 2 to 3 h      |
| 8   | #320         | `raven-windows-splash`    | `raven-windows-ci`        | The splash offers the Windows download: files read by a table of release name suffixes, the button names the visitor's platform and lists its files first                                                                       | Opus 5.5   | medium | 1 h (spent)   |

Each PR also costs one review (RTime). Stack total: about 24 h of work plus 8 × RTime.

## Gates and caveats

- **The real-GPU check gates rows 4 to 7.** The spike (`raven-windows-spike`, never merged) proved on `windows-2025`, which renders with WARP, that mpv in the BrowserWindow's own HWND draws under a transparent Electron page and the page keeps the mouse. It has not run on a physical Windows GPU. If a real GPU reorders the stacking, the fallback is mpv's render API into a shared texture Chromium composites: a new row of 2 to 3 days.
- The Windows packaged app (installer, zip, audit and smoke) passed on `windows-2025` on #314; that runner has no physical GPU, so the check above still stands.
- **A transparent frameless window on Windows has no native resize edges or Snap layouts** (row 4's window): the page needs its own resize handles, in row 5 or a row of its own.
- **Row 3 carries the variance**: up to 10 h if MSVC fights the MinGW-built DLL's import library or the N-API headers.
- Intel Macs are out of scope (last shipped 2020; macOS 26 is the last release for them).
- The Netlify site `maester` for row 1 has to be created by hand: base directory the repo root, package directory `apps/raven/splash`.

## Constraints on every PR

1. No direct `bunx` in anything new: a `package.json` script, run with `bun run <script>`.
2. One large commit per PR; the reviewer decides from the diff whether to split it.
3. Run `/thermo-nuclear-code-quality-review` on the PR once the work is done and apply its findings before handing it over.
4. Every new Nx target is cached, with its `inputs` and `outputs`, so Nx Cloud (back in November 2026) restores it.
5. The pre-push audit (`scripts/audit_claude_md.sh`) diffs since `origin/main`, so on a stacked branch it re-reads the whole stack below; to audit one PR's own diff, pass its stack parent: `bash scripts/audit_claude_md.sh $(git merge-base origin/<base> HEAD)`.

## Reporting

1. Read the live state: `gh pr list --state all --limit 40 --json number,title,headRefName,baseRefName,state,isDraft,mergeable,statusCheckRollup`.
2. Match each row's branch to a PR. A row with no PR is **not started**; an open PR is **open** with its checks summed up (passing, failing, pending), **merged** or **closed** otherwise. Note a base that differs from the table.
3. Print the table above with one more column, **State**, then the gates in one line each, and the next action: the first row that is not merged, and what it waits on.
4. If a row's scope, branch or base changed, update this file in the same turn.
