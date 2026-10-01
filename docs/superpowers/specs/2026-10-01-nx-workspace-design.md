# Nx workspace: maester moves in, weirwood folds in

Date: 2026-10-01. Status: sections 1 to 3 approved in conversation;
sections 4 to 7 decided during implementation and open to review in the PRs.

## Goal

This repo becomes an Nx monorepo that holds more than one product. maester
moves under `apps/maester/`, and weirwood, the self-hosted video library
already built as an Nx workspace in its own repo, folds in beside it. More
apps and libraries follow, mostly TypeScript.

Success: the web chat spec's frontend can be generated in place next, CI and
the Meleys deploy pass on each merge, and nothing about maester's behaviour
changes.

## Decisions made

| Question | Decision |
| --- | --- |
| Future projects | Mostly TypeScript |
| Package manager | Bun, pinned in `packageManager`, as weirwood already does |
| Conventions | Weirwood's: targets inferred from `package.json` scripts, `includedScripts`, oxlint, oxfmt, `tsgo` |
| Python in Nx | A `package.json` whose scripts call uv; no Python plugin, no uv workspace |
| Layout | Nested by product: `apps/<product>/<project>`, `libs/<product>/<lib>` |
| Root | Only what the workspace needs; everything product-specific lives under its product folder |
| maester's frontend | React on Vite, as weirwood's web app is, served by the API container (amends the web chat spec) |
| Order | Two PRs: maester moves first and is deployed, then weirwood folds in |

## 1. The workspace root

After both PRs the root holds:

- `package.json`: name `maester`, private, Bun workspaces `apps/*/*`,
  `libs/*/*` and `scripts`, `packageManager` pinned to Bun 1.4.2, dev
  dependencies Nx, oxlint, oxfmt and lefthook. Scripts are weirwood's:
  `build`, `test`, `typecheck`, `lint`, `lint:fix`, `format`,
  `format:check`, `verify`, `affected`, `graph`; `lint`, `verify` and
  `affected` gain `lint:py`. `dev` becomes `dev:<product>`.
- `bun.lock`, and `nx.json` from weirwood with a cached `lint:py` target
  default and `tests/**` excluded from production inputs.
- `.oxfmtrc.json` from weirwood, `lefthook.yml`, `.gitignore` as the union
  of both repos, `.github/`, `.claude/`, `LICENSE`.
- `CLAUDE.md`: workspace rules, the project table, how to run tasks through
  Nx. Product conventions live in `apps/<product>/CLAUDE.md`.
- `README.md`: a short workspace page linking each product's README.
- `docs/`: workspace-level only. Specs for every product in
  `docs/superpowers/specs/`, and the tracker's `roadmap.md` and
  `issue-map.json`.
- `scripts/`: repo tooling. The tracker and board scripts, `bump_version.sh`
  and `deploy-nas.sh`. It is an Nx project of its own so its Python is linted.

GitHub issues and the board belong to the repo, so the tracker stays at the
root.

## 2. The maester move (PR 1)

```
apps/maester/
  README.md, CLAUDE.md, VERSION, .env.example
  Dockerfile, Dockerfile.dockerignore, docker-compose.yml
  maester-data/            runtime only, gitignored
  docs/                    architecture.md, deferred.md, nas-deployment.md
  api/
    package.json           @maester/api, the Nx project over uv
    pyproject.toml, uv.lock, .python-version
    maester/, tests/, evals/cases/
  web/                     created by the web chat work
```

The image, compose, env and data belong to the product, not to one of its
projects, because the image will carry the API and the web build together.

`@maester/api` declares scripts through `includedScripts`: `dev`, `test`,
`eval` (fake model), `lint:py`, `lint:py:fix`, `format`, `format:check`. Each
calls uv in the project directory, so uv finds `pyproject.toml` without
flags. `dev` runs from `apps/maester/` so it reads the product's `.env`.
There is no `build` or `typecheck`.

`lefthook` leaves the uv dev group for a root dev dependency.
`pyproject.toml`, `uv.lock`, `.python-version` and the ruff config move
whole. The eval runner finds its cases relative to the project, so no source
file changes for the move. Files move with `git mv`.

## 3. The weirwood fold (PR 2)

- `git subtree add` of weirwood's `main` at `apps/weirwood/`, unsquashed, so
  its commit keeps its author and date. The PR must merge with a merge
  commit for that history to survive; a squash merge flattens it.
- `libs/core` moves to `libs/weirwood/core`. No project refers to another
  by path, only by package name.
- Weirwood's root `package.json`, `nx.json`, `bun.lock`, `.oxfmtrc.json` and
  `.gitignore` are deleted; PR 1 built the root from them. `bun.lock` is
  regenerated at the root.
- `README.md` stays as the product README. `CLAUDE.md` keeps its coding
  conventions and hard rules, minus the structure and commands now in the
  root file.
- `Dockerfile` and `docker-compose.yml` stay in `apps/weirwood/`, built from
  the repo root, with copy paths updated. `.dockerignore` becomes
  `apps/weirwood/Dockerfile.dockerignore`.
- Packages are scoped: `@weirwood/server`, `@weirwood/web`,
  `@weirwood/core`. The Dockerfile's `--filter` follows.
- Archiving the weirwood GitHub repo is a follow-up for the owner.

## 4. Build and deploy

- Each product's Dockerfile builds from the repo root, so it can reach the
  root `bun.lock` and shared libraries. Its `Dockerfile.dockerignore`
  allowlists the paths it copies, which keeps `.env` files, data and
  `node_modules` out of the context.
- `apps/maester/docker-compose.yml` keeps `name: maester`, the container
  name, the port, the volumes and the healthcheck; only the build block
  changes. Compose resolves `.env` and `./maester-data` next to the compose
  file, so on the NAS both move into `apps/maester/` once.
- `scripts/deploy-nas.sh [product]` still syncs the whole repo to
  `/Volumes/docker/maester`, now excluding `node_modules`, `dist`, `.nx` and
  `data` too, and prints the compose command for the product's folder.
- `apps/maester/docs/nas-deployment.md` gets a one-time migration: stop the
  container, sync, move `.env` and `maester-data/` into `apps/maester/`,
  start from there, remove the old root files.

## 5. CI and hooks

- Pull request checks: one job sets up Bun from `packageManager` and uv,
  installs with a frozen lockfile, finds the base with `nx-set-shas` and
  runs `bun run affected`. uv runs frozen. PR 2 installs ffmpeg, which
  weirwood's server and core tests use.
- Main smoke test: builds `apps/maester/Dockerfile` and checks
  `--version` and `/health` against `apps/maester/VERSION`. PR 2 adds the
  same for weirwood's image and `/api/health`.
- lefthook runs ruff on staged Python, rooted at each Python project. Bun
  installs the hooks through lefthook's postinstall.

## 6. Versioning and tooling

- `maester.__version__` reads the installed package's version instead of a
  hardcoded string, which was still `0.1.0` and has failed the smoke test on
  main since the v0.2.0 release. This is the one change to maester's code.
- Each released product keeps a `VERSION` file in its folder.
  `scripts/bump_version.sh <product> <bump>` writes it, the version in the
  product's `pyproject.toml` files and their `uv.lock` entry, commits
  `Release <product> vX.Y.Z`, and tags `<product>-vX.Y.Z`. Earlier `vX.Y.Z`
  tags stay as they are. A product without a `VERSION` file is refused.

## 7. Docs and the web chat spec

- maester's README moves to `apps/maester/README.md` with commands and links
  updated; architecture, deferred work and the deploy guide move to
  `apps/maester/docs/`.
- The web chat spec is amended in place: React on Vite in
  `apps/maester/web/` following weirwood's web conventions, built into the
  maester image and served by FastAPI, so there is one container and one
  upstream for the proxy. Module paths are relative to `apps/maester/api/`.
- The `version-bump` skill follows the new script; the tracker scripts and
  the board skill are unchanged.

## Testing

Each PR is checked as a move: lint, format and the same test counts green,
both images build and answer their health checks, and `nx graph` shows the
expected projects. No new tests.

## Order of work

1. PR 1: this spec, the version fix, the workspace root, the maester move,
   build, CI, scripts and docs. Merged and deployed to Meleys with the
   one-time migration.
2. PR 2: the weirwood fold, its CI and smoke test. Merged with a merge
   commit.
