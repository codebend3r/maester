# maester

The workspace for maester, an AI concierge for a private Plex server, and the apps and libraries that grow around it. An [Nx](https://nx.dev) 23 monorepo over [Bun](https://bun.sh) workspaces.

| Project            | Path                   | What                                                                      |
| ------------------ | ---------------------- | ------------------------------------------------------------------------- |
| `@maester/api`     | `apps/maester/api`     | maester's agent, tools, chat and FastAPI app; Python 3.12 run through uv  |
| `@weirwood/server` | `apps/weirwood/server` | weirwood's media server: NestJS on Fastify, SQLite index, ffmpeg          |
| `@weirwood/web`    | `apps/weirwood/web`    | weirwood's library and player: React 19 on Vite                           |
| `@weirwood/core`   | `libs/weirwood/core`   | weirwood's platform-agnostic core: API types, client, direct-play check   |
| `scripts`          | `scripts`              | Repo tooling: tracker and board sync, NAS deploy, version bump            |

Beside maester sits weirwood, a self-hosted direct-play video library. Each product has a README of its own: [maester](apps/maester/README.md), [weirwood](apps/weirwood/README.md).

## Develop

You need Bun at the version `package.json` pins in `packageManager`, [uv](https://docs.astral.sh/uv/) for the Python projects, and `ffmpeg` and `ffprobe` on the PATH for weirwood's server and core tests.

```bash
bun install        # Nx, oxlint, oxfmt, and the git hooks
bun run verify     # lint, format check, typecheck, tests and build for every project
bun run affected   # the same, for the projects changed since main
```

Start a product with `bun run dev:maester` or `bun run dev:weirwood`. Run one target through Nx: `bunx nx run @maester/api:test`, `bunx nx run @weirwood/server:test`, `bunx nx show project @weirwood/web`, `bun run graph`.

## Layout

```
apps/<product>/            one folder per product: its Dockerfile, compose, .env.example, VERSION, docs
apps/<product>/<project>/  its Nx projects, e.g. apps/maester/api
libs/<product>/<lib>/      libraries a product shares between its projects
libs/shared/<lib>/         libraries more than one product uses
scripts/                   repo tooling
docs/                      the tracker's roadmap and every product's design specs
```

The root holds only what the workspace needs. Projects have no `project.json`: Nx infers targets from each `package.json`'s scripts, limited to its `nx.includedScripts`. A Python project's scripts call uv.

Keep `.env` files in their product's folder. Nx loads a `.env` at the repo root into every task it runs.

## Tracker

Work is tracked in [GitHub Issues](https://github.com/codebend3r/maester/issues) and on the [maester roadmap board](https://github.com/users/codebend3r/projects/1). [`docs/roadmap.md`](docs/roadmap.md) and the issues are rendered from [`scripts/catalog.py`](scripts/catalog.py); see [maester's README](apps/maester/README.md#roadmap-and-tracker).

## Releases

`scripts/bump_version.sh <product> <patch|minor|major>` bumps a product's `VERSION`, commits `Release <product> vX.Y.Z` and tags `<product>-vX.Y.Z`.
