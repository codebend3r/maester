# Claude context for this workspace

## Rules

- The root holds only workspace files. Anything that belongs to a product (its image, compose, env, docs, version) goes under `apps/<product>/`.
- Run tasks through Nx from the repo root: `bunx nx run @luwin/api:test`, `bunx nx run-many -t test`, `bun run verify`, `bun run affected`.
- Never put a `.env` at the repo root; Nx loads it into every task. Each product reads its own beside its compose file.
- Commits and PRs follow the `commit-format` and `pr-format` skills (`MAE:` prefix).

## Structure

An Nx 23 monorepo over Bun workspaces (`apps/*/*`, `libs/*/*`, `scripts`). Projects have no `project.json`: Nx infers targets from each `package.json`'s scripts, whitelisted by its `nx.includedScripts`. A new script that should be a target goes in that list too.

| Project            | Path                    | What                                                                          |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------- |
| `@luwin/api`       | `apps/luwin/api`        | Python 3.12 package run through uv: agent, tools, chat, FastAPI, SQLite       |
| `@raven/server`    | `apps/raven/server`     | NestJS 12 on Fastify, SQLite (better-sqlite3), ffprobe/ffmpeg, vitest         |
| `@raven/web`       | `apps/raven/web`        | React 19, Vite 8, TanStack Query, zustand, SCSS modules, bun test + happy-dom |
| `@raven/core`      | `libs/raven/core`       | raven's shared core: API types and guards, API client, direct-play check      |
| `scripts`          | `scripts`               | Repo tooling; its Python is linted with luwin's pinned ruff and config        |

Python projects declare `package.json` scripts that call uv (`uv run pytest -q`, `uv run ruff check .`); Nx runs them in the project's folder. There is no Python Nx plugin and no uv workspace.

Each product folder has its own `CLAUDE.md` with that product's conventions. Design specs for every product live in `docs/superpowers/specs/`.
