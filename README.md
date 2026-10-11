# maester

maester is a self-hosted media suite: a library and player, an AI assistant for the friends who share the server, and soon their accounts. This repo is its workspace, an [Nx](https://nx.dev) 23 monorepo over [Bun](https://bun.sh) workspaces.

| App     | What it is                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| raven   | A self-hosted media library and direct-play player                                                           |
| luwin   | The AI assistant: requests, playback fixes and lag answers, in its own chat app and inside raven and rookery |
| rookery | Sign-in and account management (planned)                                                                     |

| Project         | Path                | What                                                                   |
| --------------- | ------------------- | ---------------------------------------------------------------------- |
| `@luwin/api`    | `apps/luwin/api`    | luwin's agent, tools, chat and FastAPI app; Python 3.12 run through uv |
| `@raven/server` | `apps/raven/server` | raven's media server: NestJS on Fastify, SQLite index, ffmpeg          |
| `@raven/web`    | `apps/raven/web`    | raven's library and player: React 19 on Vite                           |
| `@raven/core`   | `libs/raven/core`   | raven's platform-agnostic core: API types, client, direct-play check   |
| `scripts`       | `scripts`           | Repo tooling: tracker and board sync, NAS deploy, version bump         |

Each app has a README of its own: [luwin](apps/luwin/README.md), [raven](apps/raven/README.md).

## Develop

You need Bun at the version `package.json` pins in `packageManager`, [uv](https://docs.astral.sh/uv/) for the Python projects, and `ffmpeg` and `ffprobe` on the PATH for raven's server and core tests.

```bash
bun install        # Nx, oxlint, oxfmt, and the git hooks
bun run verify     # spellcheck, lint, format check, typecheck, tests and build for every project
bun run affected   # the same for the projects changed since main; spellcheck still covers the whole repo
```

Every pull request runs all of these on every project, then builds and health checks both production images (`.github/workflows/pull-request-checks.yml`).

Start a product with `bun run dev:luwin` or `bun run dev:raven`, then open it here:

| Project         | Started by          | URL                                | What's there                                                  |
| --------------- | ------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `@raven/web`    | `bun run dev:raven` | <http://localhost:5173>            | The library and player, hot reloaded; proxies `/api` to :8484 |
| `@raven/server` | `bun run dev:raven` | <http://localhost:8484/api/health> | The API only; in dev it serves no pages                       |
| `@luwin/api`    | `bun run dev:luwin` | <http://localhost:8020/health>     | The health check; otherwise it serves only the Seerr webhook  |

If 5173 is taken, Vite moves to the next free port; select `@raven/web:dev` in Nx's task view to see the URL it printed. `WEB_PORT` in `apps/luwin/.env` moves luwin's.

Run one target through Nx: `bunx nx run @luwin/api:test`, `bunx nx run @raven/server:test`, `bunx nx show project @raven/web`, `bun run graph`.

## Layout

```
apps/<product>/            one folder per product: its Dockerfile, compose, .env.example, VERSION, docs
apps/<product>/<project>/  its Nx projects, e.g. apps/luwin/api
libs/<product>/<lib>/      libraries a product shares between its projects
libs/shared/<lib>/         libraries more than one product uses
scripts/                   repo tooling
docs/                      the tracker's roadmap and every product's design specs
```

The root holds only what the workspace needs. Projects have no `project.json`: Nx infers targets from each `package.json`'s scripts, limited to its `nx.includedScripts`. A Python project's scripts call uv.

Keep `.env` files in their product's folder. Nx loads a `.env` at the repo root into every task it runs.

## Tracker

Work is tracked in [GitHub Issues](https://github.com/codebend3r/maester/issues) and on the [maester roadmap board](https://github.com/users/codebend3r/projects/1). [`docs/roadmap.md`](docs/roadmap.md) and the issues are rendered from [`scripts/catalog.py`](scripts/catalog.py); see [luwin's README](apps/luwin/README.md#roadmap-and-tracker).

## Releases

`scripts/bump_version.sh <product> <patch|minor|major>` bumps a product's `VERSION`, commits `Release <product> vX.Y.Z` and tags `<product>-vX.Y.Z`.
