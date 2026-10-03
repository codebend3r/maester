# The suite rename: raven, luwin and rookery

Date: 2026-10-02. Status: names decided in conversation; the rest is open to
review in the PRs.

## Goal

The workspace becomes a named suite. maester stays the name of the whole
thing, and each app inside it gets its own name from the same story: a
maester keeps the ravens in the rookery, and Maester Luwin is the one who
serves the house.

| Name    | What it is                                                                       | Today                            |
| ------- | -------------------------------------------------------------------------------- | -------------------------------- |
| maester | The suite: the repo, the workspace, the tracker                                  | The repo and the AI concierge    |
| raven   | The media library and direct-play player, a Plex alternative                     | weirwood                         |
| luwin   | The AI assistant: a standalone chat app and a helper window in raven and rookery | maester's agent, `apps/maester`  |
| rookery | Sign-in and account management                                                   | Not built yet                    |

Success: every project builds, tests and deploys under its new name. raven
keeps its database across the move; luwin starts fresh, without its first
chat surface, ready to become its own app. Nothing else about either app's
behaviour changes except the names it uses.

## Decisions made

| Question | Decision |
| --- | --- |
| What keeps the maester name | The repo `codebend3r/maester`, the root `package.json` (`maester`), the `MAE:` commit prefix, the "maester roadmap" board, the NAS folder `/volume1/docker/maester`, and the plex.tv client headers (`X-Plex-Product`, `X-Plex-Client-Identifier`), so plex.tv keeps seeing the same client |
| Scopes | One per app, as today: `@raven/server`, `@raven/web`, `@raven/core`, `@luwin/api` |
| Folders | `apps/raven/server`, `apps/raven/web`, `libs/raven/core`, `apps/luwin/api` |
| Python package | `luwin`, with the console scripts `luwin` and `luwin-eval` |
| Casing | Lowercase everywhere, as maester and weirwood are written today: the persona says "I'm luwin", the wordmark reads "raven" |
| Env vars | `MAESTER_MODEL`, `MAESTER_EFFORT` and `MAESTER_DB_PATH` become `LUWIN_MODEL`, `LUWIN_EFFORT` and `LUWIN_DB_PATH`. A leftover old name stops luwin on boot, naming its new name, instead of being ignored |
| Database files | `weirwood.db` becomes `raven.db`: on start, when `raven.db` is missing and `weirwood.db` sits beside it, raven renames it and its `-wal` and `-shm` files. luwin's store starts fresh as `luwin.db` in `luwin-data/`: one initial migration keyed by `user_id`, and a database from before is refused on open (decided 2026-10-03) |
| Docker | Images, containers and compose projects are `luwin` and `raven`. luwin's container user is `luwin`, uid 1000 as before |
| Release line | luwin continues maester's version line: `apps/luwin/VERSION` stays `0.2.1` and the next release is `luwin-v0.3.0`, since renamed env vars are breaking and that goes in a minor while the version is `0.y`. The `maester-v*` and `v*` tags stay |
| Tracker | `scripts/catalog.py`, `docs/roadmap.md`, `docs/issue-map.json`, the issues and the board keep their text. The suite is still maester, and re-syncing would rewrite every issue |
| Dated specs | Specs in `docs/superpowers/specs/` from before this one stay as written |
| rookery | Named in this spec and the root README. No folder or project until it has code |
| Player prefs | The browser storage key `weirwood-player` becomes `raven-player`; volume and mute reset once |
| Order | Two PRs: raven first, then luwin, which also removes luwin's first chat surface so it can become its own app, and is deployed to Meleys with a one-time move |

## 1. raven (PR 1)

- `git mv apps/weirwood apps/raven` and `git mv libs/weirwood libs/raven`,
  committed alone so git records renames.
- Every `@weirwood/*` import, script and manifest becomes `@raven/*`, and
  every `apps/weirwood` and `libs/weirwood` path becomes `apps/raven` and
  `libs/raven`, including the Dockerfile, its ignore file and CI.
- The wordmark, page title and empty-state copy say raven. The image,
  container and smoke-test job are `raven`.
- `DatabaseService` opens `raven.db` and adopts `weirwood.db` first.
- `apps/raven/README.md` gains "Coming from weirwood" for anyone running the
  old container.

## 2. luwin (PR 2)

- `git mv apps/maester apps/luwin` and `git mv apps/luwin/api/maester
  apps/luwin/api/luwin`, committed alone.
- Imports, module paths, logger names, the persona and every message luwin
  sends say luwin. The plex.tv headers keep
  `maester`.
- `pyproject.toml` names the package `luwin`, and `uv.lock` is regenerated.
- The env vars are renamed as decided above, with the refusal on boot, and
  the store starts fresh.
- luwin's first chat surface goes: its code, dependency, settings, role-based
  tiers and emoji reactions. Notices go to the log (`LogNotifier`) until
  luwin's own app delivers them.
- Compose mounts `./luwin-data:/data`. The smoke test checks
  `luwin --version` and `/health`.
- The docs, `.env.example`, lefthook, the `scripts` project,
  `deploy-nas.sh`, `bump_version.sh` and the `version-bump` skill follow.
- `apps/luwin/docs/nas-deployment.md` replaces its finished "Moving to the
  workspace layout" section with "Moving to luwin (once)".

## 3. Deploy (once, on Meleys)

Stop the old compose project, copy `.env` from `apps/maester/` to
`apps/luwin/` and rename its variables, then start luwin on a new
`luwin-data/`. The old folder stays as it is, so going back is one command.
The commands are in `apps/luwin/docs/nas-deployment.md`.

## Out of scope

- Building rookery, or embedding luwin in raven or rookery.
- The web chat spec's `apps/maester/web/` (`@maester/web`). Where it lives
  is decided when that work starts, now that luwin is meant to sit inside
  raven and rookery.
- Renaming the GitHub repo or the board.
- Releasing `luwin-v0.3.0`. That runs through the `version-bump` skill
  after the deploy.
