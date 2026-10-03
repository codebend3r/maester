# Suite rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename weirwood to raven and maester's agent to luwin, keeping maester as the suite's name, without losing the deployed assistant's database.

**Architecture:** Two stacked PRs. PR 1 (Tasks 1 and 2) moves weirwood's three projects to `apps/raven` and `libs/raven` and teaches the server to adopt `weirwood.db`. PR 2 (Tasks 3 to 5) moves `apps/maester` to `apps/luwin`, renames the Python package, the env vars and the database file with a refusal on boot and an adoption on open, and updates the docs and the NAS runbook. Each move is committed as renames alone, then rewritten by a scripted pass with a grep gate.

**Tech Stack:** Nx 23 over Bun workspaces, NestJS 12 + vitest, React 19 + bun test, Python 3.12 + uv + pytest + ruff, Docker Compose on a Synology NAS.

**Spec:** `docs/superpowers/specs/2026-10-02-suite-rename-design.md`

## Global Constraints

- Product names are lowercase everywhere, in code, UI copy, the persona and docs: maester (the suite), raven, luwin, rookery.
- These keep the maester name: the repo `codebend3r/maester`, the root `package.json` `"name"`, the `MAE:` commit prefix, the "maester roadmap" board, the NAS folder `/volume1/docker/maester` (`/Volumes/docker/maester` when mounted), the `X-Plex-Product` and `X-Plex-Client-Identifier` header values, and existing `maester-v*` tags.
- Never edited by this plan: dated specs in `docs/superpowers/specs/` from before 2026-10-02, `docs/roadmap.md`, `docs/issue-map.json`, `scripts/catalog.py`, `scripts/sync_tracker.py`, `scripts/sync_board.py`, `scripts/setup_project.sh`, `.github/PROJECT_SETUP.md`, `.github/ISSUE_TEMPLATE/`, and the `commit-format`, `pr-format` and `board-sync` skills.
- No em dashes or en dashes anywhere, including comments and UI copy.
- Run tasks through Nx from the repo root. Never put a `.env` at the repo root.
- raven's TypeScript: type aliases, no `any`, no `as`, no non-null assertions, named exports, no `for` loops, one object parameter instead of several positional ones.
- Python follows the pinned ruff config in the luwin `pyproject.toml` (line length 100).
- Commits follow the `commit-format` skill: `MAE:` subject, `-` bullets, backticked code, no agent attribution. Commits on the feature branches are part of this plan. Pushing, opening PRs, merging and the NAS deploy each need the user's go-ahead.

## Review Focus

- A NAS `.env` still setting `MAESTER_MODEL`, `MAESTER_EFFORT` or `MAESTER_DB_PATH`: luwin refuses to boot and names the new variable, instead of running on the default model or a fresh empty database. Pinned in Task 4 (`test_config.py`, `test_app.py`).
- A data folder copied after the container was killed rather than closed, so `maester.db-wal` or `weirwood.db-wal` holds recent writes: the WAL file moves with the database and no rows are lost. Pinned in Task 2 and Task 4.
- A `luwin.db` or `raven.db` already beside an old file (a second boot, a restored backup): the new file is never overwritten, and a move cut short finishes on the next open. Pinned in Task 2 and Task 4.
- The bulk rename reaching the plex.tv headers: plex.tv would see a new client. The headers stay `maester`. Pinned in Task 3 (`test_clients.py`).
- Stale local state (`node_modules/@weirwood` links, a `.venv` holding the old console scripts, Nx's cache) letting a broken rename pass locally. Tasks 1 and 3 reinstall, run `nx reset`, and check `bun install --frozen-lockfile` and `uv sync --frozen` as CI does.

---

### Task 1: Move weirwood to raven

**Files:**
- Move: `apps/weirwood/` to `apps/raven/`, `libs/weirwood/` to `libs/raven/`
- Modify: every tracked file that says `weirwood`, outside the never-edited list (manifests, imports, Dockerfile, its ignore file, compose, CI, root `package.json`, `README.md`, `CLAUDE.md`, `.gitignore`, `scripts/deploy-nas.sh`, raven's README and `CLAUDE.md`, UI copy, tests)
- Regenerate: `bun.lock`

**Interfaces:**
- Consumes: nothing.
- Produces: Nx projects `@raven/core` (`libs/raven/core`), `@raven/server` (`apps/raven/server`), `@raven/web` (`apps/raven/web`); root script `dev:raven`; Docker image and container `raven`. `apps/raven/server/src/db/database.ts` still opens `weirwood.db` (Task 2 changes that).

- [ ] **Step 1: Branch and commit the spec and plan**

```bash
git switch main && git pull --rebase
git switch -c rename-weirwood-to-raven
git add docs/superpowers/specs/2026-10-02-suite-rename-design.md docs/superpowers/plans/2026-10-02-suite-rename.md
git commit -m "$(cat <<'EOF'
MAE: design and plan for the raven and luwin rename

- maester stays the suite; weirwood becomes raven, the agent becomes luwin
- rookery is named for the account app to come
EOF
)"
```

- [ ] **Step 2: Record the baseline**

Run: `bunx nx run-many -t test -p @weirwood/core @weirwood/server @weirwood/web`
Expected: all pass. Write down the test count for each project (around core 59, server 55, web 20).

- [ ] **Step 3: Move the folders and commit the renames alone**

`git mv` on a folder renames it on disk, so untracked and ignored files inside (`node_modules`, `dist`, `apps/weirwood/server/data`) move along.

```bash
git mv apps/weirwood apps/raven
git mv libs/weirwood libs/raven
git status --short | grep -v '^R ' || true
git commit -m "MAE: move weirwood to apps/raven and libs/raven"
```

Expected: `git status --short | grep -v '^R '` prints nothing (every change is a rename).

- [ ] **Step 4: Rewrite the name**

`weirwood.db` is left for Task 2, and the palette comment in `globals.scss` ("The palette is the weirwood itself") is about the tree, so both are protected.

```bash
git ls-files -z -- . ':!docs/superpowers' ':!docs/roadmap.md' ':!docs/issue-map.json' ':!scripts/catalog.py' ':!bun.lock' \
  | xargs -0 grep -l --null weirwood \
  | xargs -0 perl -pi -e 's{weirwood\.db}{\x00DB\x00}g; s{weirwood itself}{\x00TREE\x00}g; s{weirwood}{raven}g; s{\x00DB\x00}{weirwood.db}g; s{\x00TREE\x00}{weirwood itself}g'
```

- [ ] **Step 5: Grep gate**

Run: `git grep -n -i weirwood -- . ':!docs/superpowers' ':!docs/roadmap.md' ':!docs/issue-map.json' ':!scripts/catalog.py' ':!bun.lock'`
Expected, exactly these two lines:

```
apps/raven/server/src/db/database.ts:88:    this.db = new Sqlite(join(config.dataDir, 'weirwood.db'))
apps/raven/web/src/styles/globals.scss:4:// The palette is the weirwood itself: a godswood at night for the ground,
```

Then read `git diff` for `README.md`, `CLAUDE.md` and `apps/raven/README.md`, and realign any markdown table whose columns shifted (`@raven/server` is shorter than `@weirwood/server`).

- [ ] **Step 6: Reinstall from clean state**

```bash
rm -rf node_modules/@weirwood
bun install
bun install --frozen-lockfile
bunx nx reset
bunx nx show projects
```

Expected: `bun install --frozen-lockfile` succeeds with no changes. `nx show projects` lists `@raven/core`, `@raven/server`, `@raven/web`, `@maester/api` and `scripts`, and no `@weirwood/*`. In `git diff bun.lock`, every changed line names raven or weirwood, apart from the root workspace's `"name"`.

- [ ] **Step 7: Run raven's checks**

Run: `bunx nx run-many -t lint:ts lint:css format:check typecheck test build -p @raven/core @raven/server @raven/web`
Expected: every target passes, with the same test counts as Step 2.

- [ ] **Step 8: Build and start the image**

```bash
docker build -f apps/raven/Dockerfile -t raven:check .
docker run -d --name raven-check -p 18484:8484 raven:check
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS http://127.0.0.1:18484/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18484/
docker rm -f raven-check
```

Expected: the health body has `"status":"ok"` and `"tonemap":true`, and `/` returns `200`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
MAE: rename weirwood to raven

- `@weirwood/*` packages are `@raven/server`, `@raven/web` and `@raven/core`
- paths, Docker, compose, CI, docs and UI copy say raven
- `bun run dev:raven` starts the server and the web app
- the player's browser key is `raven-player`, so volume and mute reset once
- `weirwood.db` keeps its name until the next commit adopts it
EOF
)"
```

---

### Task 2: raven opens `raven.db` and adopts `weirwood.db`

**Files:**
- Modify: `apps/raven/server/src/db/database.ts:1` (imports) and `:85-89` (constructor), plus new exports above `DatabaseService`
- Create: `apps/raven/server/src/db/database.test.ts`
- Modify: `apps/raven/README.md` (new subsection under "Run it with Docker")

**Interfaces:**
- Consumes: `DatabaseService` and `readServerConfig` as they are.
- Produces: `export const DATABASE_FILE = 'raven.db'` and `export const adoptLegacyDatabase = ({ dataDir }: { dataDir: string }): void`, both from `@/db/database.js`. `DatabaseService` opens `join(config.dataDir, DATABASE_FILE)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/raven/server/src/db/database.test.ts`:

```ts
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config.js'
import { adoptLegacyDatabase, DatabaseService } from '@/db/database.js'

describe('the database file', () => {
  const state = { dir: '' }
  const at = (name: string): string => join(state.dir, name)
  const files = async (): Promise<string[]> => (await readdir(state.dir)).toSorted()
  const seed = async ({ names }: { names: string[] }): Promise<void> => {
    await Promise.all(names.map((name) => writeFile(at(name), name)))
  }

  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'raven-db-'))
  })

  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it("opens weirwood's database under raven's name, rows and all", () => {
    const legacy = new Sqlite(at('weirwood.db'))
    legacy.exec("CREATE TABLE marker (note TEXT); INSERT INTO marker VALUES ('kept')")
    legacy.close()
    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(database.db.prepare('SELECT note FROM marker').get()).toEqual({ note: 'kept' })
    database.onModuleDestroy()
    expect(existsSync(at('weirwood.db'))).toBe(false)
  })

  it('moves the WAL and shared-memory files with it', async () => {
    await seed({ names: ['weirwood.db', 'weirwood.db-wal', 'weirwood.db-shm'] })
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual(['raven.db', 'raven.db-shm', 'raven.db-wal'])
    expect(await readFile(at('raven.db-wal'), 'utf8')).toBe('weirwood.db-wal')
  })

  it('never replaces a raven.db that is already there', async () => {
    await writeFile(at('raven.db'), 'new')
    await writeFile(at('weirwood.db'), 'old')
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual(['raven.db', 'weirwood.db'])
    expect(await readFile(at('raven.db'), 'utf8')).toBe('new')
  })

  it('finishes a move that stopped before the database itself', async () => {
    await seed({ names: ['raven.db-wal', 'weirwood.db'] })
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual(['raven.db', 'raven.db-wal'])
  })

  it('leaves an empty data folder empty', async () => {
    adoptLegacyDatabase({ dataDir: state.dir })
    expect(await files()).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/db/database.test.ts`
Expected: FAIL, `adoptLegacyDatabase` is not exported from `@/db/database.js`.

- [ ] **Step 3: Implement**

In `apps/raven/server/src/db/database.ts`, change the first import to:

```ts
import { existsSync, mkdirSync, renameSync } from 'node:fs'
```

Add above the `DatabaseService` doc comment:

```ts
/** The index's file in the data folder. Before raven was renamed it was `weirwood.db`. */
export const DATABASE_FILE = 'raven.db'
const LEGACY_FILE = 'weirwood.db'

/**
 * SQLite keeps recent writes in `-wal` until they are copied into the
 * database, and an index of them in `-shm`, both named after the database, so
 * they move with it. The database itself moves last: a move cut short leaves
 * it under its old name, and the next start finishes the job.
 */
const MOVE_ORDER: readonly string[] = ['-wal', '-shm', '']

/**
 * Renames weirwood's database in `dataDir` to raven's, once, so the index,
 * progress and favourites carry over. Does nothing when raven's file is
 * already there or there is nothing to adopt. Call it before opening.
 */
export const adoptLegacyDatabase = ({ dataDir }: { dataDir: string }): void => {
  const target = join(dataDir, DATABASE_FILE)
  const legacy = join(dataDir, LEGACY_FILE)
  if (existsSync(target) || !existsSync(legacy)) return
  MOVE_ORDER.filter((suffix) => existsSync(legacy + suffix)).forEach((suffix) =>
    renameSync(legacy + suffix, target + suffix),
  )
}
```

Change the constructor body's first two lines to:

```ts
    mkdirSync(config.dataDir, { recursive: true })
    adoptLegacyDatabase({ dataDir: config.dataDir })
    this.db = new Sqlite(join(config.dataDir, DATABASE_FILE))
```

- [ ] **Step 4: Run them to see them pass**

Run: `bunx nx run @raven/server:test -- src/db/database.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Document the move for running instances**

In `apps/raven/README.md`, add after the numbered list in "Run it with Docker" (before "## How playback works"):

```markdown
### Coming from weirwood

raven was called weirwood. Its database is now `raven.db`, and the server renames a `weirwood.db` it finds in the data folder, with its `-wal` and `-shm` files, the first time it starts. To move a running weirwood container over:

1. `docker compose down` in `apps/weirwood/`.
2. Move `apps/weirwood/data` to `apps/raven/data`, and copy your media volume lines from `apps/weirwood/docker-compose.yml` into `apps/raven/docker-compose.yml`.
3. `docker compose up -d --build` in `apps/raven/`.

The player forgets its volume and mute setting once, since the browser now keeps it under raven's name.
```

- [ ] **Step 6: Run raven's checks, then try it on local data**

Run: `bunx nx run-many -t lint:ts format:check typecheck test build -p @raven/server`
Expected: all pass; the server's test count is Step 2 of Task 1 plus 5.

Then run `bun run dev:raven`, stop it once the server logs that it is listening, and run `ls apps/raven/server/data`.
Expected: `raven.db` is listed and `weirwood.db` is gone (the local dev data folder had a `weirwood.db`; if it did not, the listing just shows `raven.db`).

- [ ] **Step 7: Commit**

```bash
git add apps/raven/server/src/db/database.ts apps/raven/server/src/db/database.test.ts apps/raven/README.md
git commit -m "$(cat <<'EOF'
MAE: raven opens raven.db and adopts weirwood.db

- on start, a `weirwood.db` with no `raven.db` beside it is renamed, `-wal` and `-shm` first
- an existing `raven.db` is never replaced; a move cut short finishes on the next start
- raven's README says how to move a running weirwood container
EOF
)"
```

PR 1 ends here. Pushing and opening it needs the user's go-ahead (Task 6).

---

### Task 3: Move maester's agent to luwin

**Files:**
- Move: `apps/maester/` to `apps/luwin/`, `apps/luwin/api/maester/` to `apps/luwin/api/luwin/`
- Modify: every tracked file under `apps/luwin/api/`, plus `apps/luwin/Dockerfile`, `apps/luwin/Dockerfile.dockerignore`, `apps/luwin/docker-compose.yml`, `lefthook.yml`, `scripts/package.json`, `scripts/deploy-nas.sh`, `scripts/bump_version.sh`, `.github/workflows/main-smoke-test.yml`, `.gitignore`, `.claude/skills/version-bump/SKILL.md`, root `package.json` (scripts only)
- Test: `apps/luwin/api/tests/test_clients.py` (new pin test, written before the move)
- Regenerate: `apps/luwin/api/uv.lock`

**Interfaces:**
- Consumes: Task 1's layout (the branch is stacked on PR 1).
- Produces: Python package `luwin` (`apps/luwin/api/luwin/`), console scripts `luwin` and `luwin-eval`, Nx project `@luwin/api` tagged `scope:luwin`, class `luwin.chat.bot.LuwinBot`, `luwin --version` printing `luwin <version>`, FastAPI title `luwin`, default `db_path` `/data/luwin.db`, compose volume `./luwin-data:/data`, image and container `luwin`, root script `dev:luwin`. Env vars are still `MAESTER_*` (Task 4 renames them).

- [ ] **Step 1: Branch and record the baseline**

```bash
git switch rename-weirwood-to-raven
git switch -c rename-agent-to-luwin
bunx nx run-many -t lint:py format:check test eval -p @maester/api scripts
```

Expected: all pass. Write down the pytest count for `@maester/api` (around 548).

- [ ] **Step 2: Pin the plex.tv headers to the suite's name**

The bulk rewrite in Step 5 skips every line containing `X-Plex-`, so this test and the client keep their header values. Add to `apps/maester/api/tests/test_clients.py`, after `test_plex_tv_reads_servers_libraries_and_friends_shares_and_writes_one`:

```python
@respx.mock
async def test_plex_tv_sees_the_suite_name_in_its_client_headers():
    # plex.tv tells clients apart by these headers; they carry the suite's name.
    route = respx.get(f"{PLEX_TV}/api/servers").respond(text="<MediaContainer/>")
    await PlexTvClient(PLEX_TV, "owner-token").servers()
    sent = route.calls.last.request.headers
    assert sent["X-Plex-Product"] == sent["X-Plex-Client-Identifier"] == "maester"
```

Run: `bunx nx run @maester/api:test -- tests/test_clients.py -k suite_name`
Expected: 1 passed.

```bash
git add apps/maester/api/tests/test_clients.py
git commit -m "MAE: pin the plex.tv client headers to the suite name"
```

- [ ] **Step 3: Move the folders and commit the renames alone**

```bash
git mv apps/maester apps/luwin
git mv apps/luwin/api/maester apps/luwin/api/luwin
git status --short | grep -v '^R ' || true
git commit -m "MAE: move the agent to apps/luwin and the package to luwin"
```

Expected: `git status --short | grep -v '^R '` prints nothing.

- [ ] **Step 4: Point the root scripts at luwin**

In the root `package.json`, change only this line (the `"name"` and `"description"` stay; Task 5 rewrites the description):

```json
    "dev:luwin": "nx run @luwin/api:dev",
```

replacing `"dev:maester": "nx run @maester/api:dev",`.

- [ ] **Step 5: Rewrite the name**

Lowercase `maester` becomes `luwin` and `Maester` becomes `Luwin` (`MaesterBot` to `LuwinBot`). Uppercase `MAESTER_` is untouched (Task 4). Lines with `X-Plex-` are skipped, and the NAS folder, repo URL, board and old tags are protected.

```bash
git ls-files -z -- apps/luwin/api apps/luwin/Dockerfile apps/luwin/Dockerfile.dockerignore apps/luwin/docker-compose.yml \
    lefthook.yml scripts/package.json scripts/deploy-nas.sh scripts/bump_version.sh \
    .github/workflows/main-smoke-test.yml .gitignore .claude/skills/version-bump/SKILL.md \
  | xargs -0 grep -l --null -i maester \
  | xargs -0 perl -pi -e 'next if /X-Plex-/; s{docker/maester}{\x00NAS\x00}g; s{codebend3r/maester}{\x00REPO\x00}g; s{maester roadmap}{\x00BOARD\x00}g; s{maester-v}{\x00TAG\x00}g; s{maester}{luwin}g; s{Maester}{Luwin}g; s{\x00NAS\x00}{docker/maester}g; s{\x00REPO\x00}{codebend3r/maester}g; s{\x00BOARD\x00}{maester roadmap}g; s{\x00TAG\x00}{maester-v}g'
```

- [ ] **Step 6: Grep gate**

Run: `git grep -n -i maester -- apps/luwin/api apps/luwin/Dockerfile apps/luwin/Dockerfile.dockerignore apps/luwin/docker-compose.yml lefthook.yml scripts/package.json scripts/deploy-nas.sh scripts/bump_version.sh .github/workflows/main-smoke-test.yml .gitignore .claude/skills/version-bump/SKILL.md`
Expected: only these, and nothing else:
- `apps/luwin/api/luwin/clients/plextv.py`: the `X-Plex-Client-Identifier` and `X-Plex-Product` lines
- `apps/luwin/api/tests/test_clients.py`: the pin test's `assert` line
- `apps/luwin/api/luwin/config.py` and `apps/luwin/api/tests/test_config.py`: the `MAESTER_MODEL`, `MAESTER_EFFORT` and `MAESTER_DB_PATH` lines
- `scripts/deploy-nas.sh`: the lines naming `/Volumes/docker/maester` or `/volume1/docker/maester`

Then skim `git diff -- apps/luwin/api/luwin/agent/prompts.py apps/luwin/api/luwin/chat/service.py`: the persona reads "You are luwin, the concierge for a private Plex server" and the greeting "Hi! I'm luwin, the concierge for this Plex server."

- [ ] **Step 7: Rebuild the environment**

The old `.venv` holds a `maester` console script and paths to the old folder.

```bash
rm -rf apps/luwin/api/.venv apps/luwin/api/.pytest_cache apps/luwin/api/.ruff_cache
(cd apps/luwin/api && uv lock && uv sync --frozen)
bun install && bun install --frozen-lockfile
bunx nx reset
bunx nx show projects
```

Expected: `uv lock` changes only the project's own entry name in `uv.lock` (`name = "luwin"`). `nx show projects` lists `@luwin/api` and no `@maester/api`.

- [ ] **Step 8: Run luwin's checks**

Run: `bunx nx run-many -t lint:py format:check test eval -p @luwin/api scripts`
Expected: all pass. The pytest count is Step 1's plus 1. The fake-model eval gives the same result as Step 1's.

If `lint:py` reports import order (I001), run `bunx nx run @luwin/api:lint:py:fix` and `bunx nx run @luwin/api:format`, then rerun.

- [ ] **Step 9: Build and check the image**

```bash
docker build -f apps/luwin/Dockerfile -t luwin:check .
docker run --rm luwin:check luwin --version
docker run -d --name luwin-check -p 18020:8020 luwin:check uvicorn luwin.web:create_app --factory --host 0.0.0.0 --port 8020
curl --retry 20 --retry-all-errors --retry-delay 1 -fsS http://127.0.0.1:18020/health
docker rm -f luwin-check
```

Expected: `luwin 0.2.1`, then a `/health` body with `"status":"ok"` and `"version":"0.2.1"`.

- [ ] **Step 10 (optional, uses the Anthropic API): real-model evals**

The persona's name changed, so the PR checklist asks for evals. With `ANTHROPIC_API_KEY` set, run `uv run luwin-eval` in `apps/luwin/api` and `uv run maester-eval` on `main` in a separate worktree, and compare. Expected: the same cases pass. Skip this only if the user says so, and say it was skipped in the PR.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
MAE: rename the agent package and project to luwin

- the Python package and dist are `luwin`, with `luwin` and `luwin-eval` scripts
- the Nx project is `@luwin/api`; `bun run dev:luwin` starts it
- the persona, greeting, log names and `LuwinBot` say luwin
- the image, container and compose project are `luwin`, mounting `./luwin-data`
- the plex.tv headers keep the suite's name, pinned by a test
EOF
)"
```

---

### Task 4: luwin's env vars and database file

**Files:**
- Modify: `apps/luwin/api/luwin/config.py` (after `require()`, and the three `load_settings` lines)
- Modify: `apps/luwin/api/luwin/store/base.py` (after `MIGRATIONS_DIR`, and `Database.__init__`)
- Modify: `apps/luwin/api/luwin/app.py:44` (import) and `run()`
- Modify: `apps/luwin/.env.example`
- Test: `apps/luwin/api/tests/test_config.py`, `apps/luwin/api/tests/test_store.py`, `apps/luwin/api/tests/test_app.py`

**Interfaces:**
- Consumes: `luwin.config.load_settings`, `luwin.store.Store`, `luwin.app.run` from Task 3.
- Produces: `luwin.config.RENAMED: dict[str, str]`, `luwin.config.RenamedConfig(KeyError)` with `.names: list[str]`, `luwin.config.refuse_renamed(env: Mapping[str, str]) -> None`, `luwin.store.base.LEGACY_NAME = "maester.db"`, `luwin.store.base.adopt_legacy(path: str | Path) -> None`. Settings read `LUWIN_MODEL`, `LUWIN_EFFORT` and `LUWIN_DB_PATH`.

- [ ] **Step 1: Write the failing tests**

In `apps/luwin/api/tests/test_config.py`, add `RenamedConfig` and `refuse_renamed` to the `from luwin.config import (...)` list, change `"MAESTER_MODEL": "claude-sonnet-5",` in `test_values_are_parsed_and_urls_stripped` to `"LUWIN_MODEL": "claude-sonnet-5",`, and add:

```python
def test_old_variable_names_are_refused_with_their_new_names():
    with pytest.raises(RenamedConfig) as exc:
        refuse_renamed(
            {"MAESTER_DB_PATH": "", "MAESTER_MODEL": "claude-sonnet-5", "LUWIN_EFFORT": "low"}
        )
    assert exc.value.names == ["MAESTER_MODEL", "MAESTER_DB_PATH"]
    assert "MAESTER_MODEL is now LUWIN_MODEL, MAESTER_DB_PATH is now LUWIN_DB_PATH" in str(
        exc.value
    )


def test_new_variable_names_pass_and_are_read():
    env = {"LUWIN_MODEL": "claude-sonnet-5", "LUWIN_EFFORT": "low", "LUWIN_DB_PATH": "/data/x.db"}
    refuse_renamed(env)
    s = load_settings(env)
    assert (s.model, s.effort, s.db_path) == ("claude-sonnet-5", "low", "/data/x.db")
```

In `apps/luwin/api/tests/test_store.py`, change `from luwin.store.base import stamp` to `from luwin.store.base import adopt_legacy, stamp`, and add:

```python
def _files(folder):
    return sorted(p.name for p in folder.iterdir())


def test_a_maester_database_opens_under_its_new_name_with_its_rows(tmp_path):
    conn = sqlite3.connect(tmp_path / "maester.db")
    conn.execute("CREATE TABLE marker (note TEXT)")
    conn.execute("INSERT INTO marker VALUES ('kept')")
    conn.commit()
    conn.close()
    Store(tmp_path / "luwin.db").close()
    assert not (tmp_path / "maester.db").exists()
    check = sqlite3.connect(tmp_path / "luwin.db")
    assert check.execute("SELECT note FROM marker").fetchall() == [("kept",)]
    check.close()


def test_the_wal_and_shm_files_move_with_the_database(tmp_path):
    for name in ("maester.db", "maester.db-wal", "maester.db-shm"):
        (tmp_path / name).write_text(name)
    adopt_legacy(tmp_path / "luwin.db")
    assert _files(tmp_path) == ["luwin.db", "luwin.db-shm", "luwin.db-wal"]
    assert (tmp_path / "luwin.db-wal").read_text() == "maester.db-wal"


def test_an_existing_luwin_database_is_never_replaced(tmp_path):
    (tmp_path / "luwin.db").write_text("new")
    (tmp_path / "maester.db").write_text("old")
    adopt_legacy(tmp_path / "luwin.db")
    assert _files(tmp_path) == ["luwin.db", "maester.db"]
    assert (tmp_path / "luwin.db").read_text() == "new"


def test_a_move_cut_short_finishes_on_the_next_open(tmp_path):
    (tmp_path / "luwin.db-wal").write_text("maester.db-wal")
    (tmp_path / "maester.db").write_text("maester.db")
    adopt_legacy(tmp_path / "luwin.db")
    assert _files(tmp_path) == ["luwin.db", "luwin.db-wal"]


def test_nothing_to_adopt_leaves_the_folder_empty(tmp_path):
    adopt_legacy(tmp_path / "luwin.db")
    assert _files(tmp_path) == []
```

In `apps/luwin/api/tests/test_app.py`, add `import pytest` above the `fastapi` import, change the imports to `from luwin.app import build, build_services, run` and `from luwin.config import RenamedConfig, load_settings`, and add:

```python
def test_boot_refuses_an_old_variable_name_before_anything_else(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # no `.env` here to read
    monkeypatch.setenv("MAESTER_DB_PATH", "/data/maester.db")
    # Required variables are missing too; the rename is reported first.
    with pytest.raises(RenamedConfig, match="MAESTER_DB_PATH is now LUWIN_DB_PATH"):
        run()
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @luwin/api:test -- tests/test_config.py tests/test_store.py tests/test_app.py`
Expected: collection errors, `cannot import name 'RenamedConfig'` and `cannot import name 'adopt_legacy'`.

- [ ] **Step 3: Implement the refusal**

In `apps/luwin/api/luwin/config.py`, add after `require()`:

```python
# Renamed when the assistant became luwin. A leftover old name would be read by
# nothing, so the model, effort or database would quietly fall back to the
# defaults; boot refuses it instead, naming the new one.
RENAMED = {
    "MAESTER_MODEL": "LUWIN_MODEL",
    "MAESTER_EFFORT": "LUWIN_EFFORT",
    "MAESTER_DB_PATH": "LUWIN_DB_PATH",
}


class RenamedConfig(KeyError):
    """Raised by `refuse_renamed()` naming every old variable still set, and its new name."""

    def __init__(self, names: list[str]):
        self.names = names
        renames = ", ".join(f"{name} is now {RENAMED[name]}" for name in names)
        super().__init__(f"renamed environment variables: {renames}")


def refuse_renamed(env: Mapping[str, str]) -> None:
    leftover = [name for name in RENAMED if name in env]
    if leftover:
        raise RenamedConfig(leftover)
```

In `load_settings`, read the new names:

```python
        model=env.get("LUWIN_MODEL", "").strip() or "claude-opus-5-5",
        effort=env.get("LUWIN_EFFORT", "").strip() or "medium",
```

```python
        db_path=env.get("LUWIN_DB_PATH", "").strip() or "/data/luwin.db",
```

In `apps/luwin/api/luwin/app.py`, add `refuse_renamed` to the `from luwin.config import ...` line, and in `run()` call it before `require`:

```python
    load_env_file()
    refuse_renamed(os.environ)
    require(os.environ, *REQUIRED)
```

- [ ] **Step 4: Implement the adoption**

In `apps/luwin/api/luwin/store/base.py`, add after `MIGRATIONS_DIR`:

```python
# The database's name before the assistant became luwin.
LEGACY_NAME = "maester.db"
# SQLite keeps recent writes in `-wal` until they are copied into the database,
# and an index of them in `-shm`, both named after the database, so they move
# with it. The database itself moves last: a move cut short leaves it under its
# old name, and the next open finishes the job.
_MOVE_ORDER = ("-wal", "-shm", "")


def adopt_legacy(path: str | Path) -> None:
    """Rename a `maester.db` beside `path` to `path`, once, so its rows carry over.

    Nothing happens when `path` already exists or there is no old file beside it.
    """
    new = Path(path)
    old = new.with_name(LEGACY_NAME)
    if new.exists() or not old.exists():
        return
    for suffix in _MOVE_ORDER:
        source = old.with_name(old.name + suffix)
        if source.exists():
            source.rename(new.with_name(new.name + suffix))
```

In `Database.__init__`, call it inside the existing `:memory:` check:

```python
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            adopt_legacy(self.path)
```

- [ ] **Step 5: Run them to see them pass**

Run: `bunx nx run @luwin/api:test -- tests/test_config.py tests/test_store.py tests/test_app.py`
Expected: all pass, including the 8 new tests.

- [ ] **Step 6: Rename the variables in the example env**

```bash
perl -pi -e 's/MAESTER_/LUWIN_/g; s/maester\.db/luwin.db/g' apps/luwin/.env.example
git grep -n -i maester -- apps/luwin/.env.example apps/luwin/api
```

Expected from the grep: only the two `X-Plex-` lines in `plextv.py`, the pin test's `assert`, the `RENAMED` entries and docstring in `config.py`, `LEGACY_NAME` and the `adopt_legacy` docstring in `store/base.py`, and the new tests that name the old variables or `maester.db`.

If you have a local `apps/luwin/.env`, run the same `perl` line on it, or `bun run dev:luwin` stops on boot naming the old variables.

- [ ] **Step 7: Run luwin's checks**

Run: `bunx nx run-many -t lint:py format:check test eval -p @luwin/api scripts`
Expected: all pass; the pytest count is Task 3's plus 8.

- [ ] **Step 8: Commit**

```bash
git add apps/luwin/api apps/luwin/.env.example
git commit -m "$(cat <<'EOF'
MAE: luwin reads LUWIN_* variables and adopts maester.db

- `MAESTER_MODEL`, `MAESTER_EFFORT` and `MAESTER_DB_PATH` are `LUWIN_*`
- a leftover old name stops boot and names its replacement
- the database is `luwin.db`; a `maester.db` beside a missing one is renamed with its `-wal` and `-shm`
- an existing `luwin.db` is never replaced
EOF
)"
```

---

### Task 5: Docs, the runbook and the suite description

**Files:**
- Modify: `apps/luwin/README.md`, `apps/luwin/CLAUDE.md`, `apps/luwin/docs/architecture.md`, `apps/luwin/docs/deferred.md`, `apps/luwin/docs/nas-deployment.md`
- Modify: root `README.md`, root `CLAUDE.md`, root `package.json` (`"description"`), `.claude/skills/version-bump/SKILL.md`

**Interfaces:**
- Consumes: every name from Tasks 1 to 4.
- Produces: docs only. `apps/luwin/docs/nas-deployment.md` gains "Moving to luwin (once)", which Task 6 follows on the NAS.

- [ ] **Step 1: Rewrite the docs with the protected pass**

```bash
perl -pi -e 'next if /X-Plex-/; s{docker/maester}{\x00NAS\x00}g; s{codebend3r/maester}{\x00REPO\x00}g; s{maester roadmap}{\x00BOARD\x00}g; s{maester-v}{\x00TAG\x00}g; s{MAESTER_}{LUWIN_}g; s{maester}{luwin}g; s{Maester}{Luwin}g; s{\x00NAS\x00}{docker/maester}g; s{\x00REPO\x00}{codebend3r/maester}g; s{\x00BOARD\x00}{maester roadmap}g; s{\x00TAG\x00}{maester-v}g' \
  apps/luwin/README.md apps/luwin/CLAUDE.md apps/luwin/docs/architecture.md apps/luwin/docs/deferred.md apps/luwin/docs/nas-deployment.md README.md CLAUDE.md
```

- [ ] **Step 2: Put the suite back where the pass replaced it**

Root `README.md`: replace everything from the `# luwin` title through the paragraph that starts "Beside luwin sits raven" with:

```markdown
# maester

maester is a self-hosted media suite: a library and player, an AI assistant for the friends who share the server, and soon their accounts. This repo is its workspace, an [Nx](https://nx.dev) 23 monorepo over [Bun](https://bun.sh) workspaces.

| App     | What it is                                                                   |
| ------- | ---------------------------------------------------------------------------- |
| raven   | A self-hosted media library and direct-play player                           |
| luwin   | The AI assistant: requests, playback fixes and lag answers for friends on Discord |
| rookery | Sign-in and account management (planned)                                     |

| Project         | Path                | What                                                                   |
| --------------- | ------------------- | ---------------------------------------------------------------------- |
| `@luwin/api`    | `apps/luwin/api`    | luwin's agent, tools, chat and FastAPI app; Python 3.12 run through uv |
| `@raven/server` | `apps/raven/server` | raven's media server: NestJS on Fastify, SQLite index, ffmpeg          |
| `@raven/web`    | `apps/raven/web`    | raven's library and player: React 19 on Vite                           |
| `@raven/core`   | `libs/raven/core`   | raven's platform-agnostic core: API types, client, direct-play check   |
| `scripts`       | `scripts`           | Repo tooling: tracker and board sync, NAS deploy, version bump         |

Each app has a README of its own: [luwin](apps/luwin/README.md), [raven](apps/raven/README.md).
```

Realign the app table so its column of pipes lines up after the longer luwin row.

Root `package.json`, set the description:

```json
  "description": "Nx workspace for maester, a self-hosted media suite: raven, a media library and direct-play player, luwin, an AI assistant for a private Plex server, and the apps and libraries around them",
```

`apps/luwin/README.md`: lines 3 and 5 become:

```markdown
The AI assistant of the maester suite, a concierge for a private Plex server. Friends talk to it on Discord in plain language; it requests movies and shows, works out why something will not play, explains lag with live server data, and hands the admin an approval queue instead of a group chat thread.

luwin is the suite's maester: it serves the house, answers its questions, and sends the ravens.
```

`apps/luwin/CLAUDE.md` line 3: start it with `The AI assistant of the maester suite, a concierge for a private Plex server.` in place of `An AI concierge for a private Plex server.`

- [ ] **Step 3: Replace the finished move section in the runbook**

In `apps/luwin/docs/nas-deployment.md`, replace the whole `## Moving to the workspace layout (once)` section (its heading through the paragraph that lists the old root files) with:

````markdown
## Moving to luwin (once)

Until the rename, the assistant ran as `maester` from `apps/maester/`, with its state in `apps/maester/.env` and `apps/maester/maester-data/maester.db`. luwin reads `.env` and `luwin-data/` beside `apps/luwin/docker-compose.yml`, its model and database variables are `LUWIN_*`, and an old `MAESTER_*` name stops it on boot. On first open it renames `maester.db`, with its `-wal` and `-shm` files, to `luwin.db`. Move the rest once, with the old container down so the SQLite file is quiet:

```bash
scripts/deploy-nas.sh
ssh crivas@192.168.50.2
cd /volume1/docker/maester/apps
sudo -n /usr/local/bin/docker exec maester python -c "import sqlite3; print(sqlite3.connect('/data/maester.db').execute('select count(*) from users').fetchone()[0])"
(cd maester && sudo -n /usr/local/bin/docker compose down)
mkdir -p ~/maester-backup && cp -p maester/maester-data/maester.db* ~/maester-backup/
mv maester/.env luwin/.env
mv maester/maester-data luwin/luwin-data
sed -i -e 's/^MAESTER_/LUWIN_/' -e 's#^LUWIN_DB_PATH=/data/maester.db$#LUWIN_DB_PATH=/data/luwin.db#' luwin/.env
grep -n 'LUWIN_' luwin/.env
cd luwin && sudo -n /usr/local/bin/docker compose up -d --build
curl -fsS http://127.0.0.1:8020/health
sudo -n /usr/local/bin/docker exec luwin python -c "import sqlite3; print(sqlite3.connect('/data/luwin.db').execute('select count(*) from users').fetchone()[0])"
```

The two counts match. If `.env` set `MAESTER_DB_PATH` to anything other than `/data/maester.db`, fix `LUWIN_DB_PATH` by hand before `compose up`.

If luwin will not come up healthy, put maester back; its old files and image are still on the NAS:

```bash
cd /volume1/docker/maester/apps
(cd luwin && sudo -n /usr/local/bin/docker compose down)
mv luwin/.env maester/.env && mv luwin/luwin-data maester/maester-data
for f in maester/maester-data/luwin.db*; do mv "$f" "maester/maester-data/maester.db${f##*luwin.db}"; done
sed -i -e 's/^LUWIN_/MAESTER_/' -e 's#^MAESTER_DB_PATH=/data/luwin.db$#MAESTER_DB_PATH=/data/maester.db#' maester/.env
(cd maester && sudo -n /usr/local/bin/docker compose up -d)
```

The sync never deletes, so `apps/maester/`, and `apps/weirwood/` and `libs/weirwood/` from raven's rename, stay behind. Once luwin has been healthy for a few days, remove them, `~/maester-backup` and the old image: `rm -rf /volume1/docker/maester/apps/maester /volume1/docker/maester/apps/weirwood /volume1/docker/maester/libs/weirwood ~/maester-backup && sudo -n /usr/local/bin/docker image rm maester`.
````

- [ ] **Step 4: Note the old tags in the version-bump skill**

In `.claude/skills/version-bump/SKILL.md`, after the sentence "Releases before the workspace move were tagged plain `vX.Y.Z`; those tags stay as they are.", add:

```markdown
luwin was released as maester until the rename, so its earlier tags are `maester-vX.Y.Z`; they stay too, and the first luwin release is `luwin-v0.3.0`.
```

- [ ] **Step 5: Grep gate for the whole repo**

```bash
git grep -n -w -i maester -- . ':!docs/superpowers' ':!docs/roadmap.md' ':!docs/issue-map.json' ':!scripts/catalog.py' ':!scripts/sync_tracker.py' ':!scripts/sync_board.py' ':!scripts/setup_project.sh' ':!.github/PROJECT_SETUP.md' ':!.github/ISSUE_TEMPLATE' ':!.claude/skills/commit-format' ':!.claude/skills/pr-format' ':!.claude/skills/board-sync' \
  | grep -vE 'codebend3r/maester|docker/maester|maester roadmap|maester-v|X-Plex-'
```

Expected: every line left is one of these, and nothing else:
- `package.json`: `"name": "maester"` and the description
- `README.md`: the `# maester` title and the suite paragraph
- `apps/luwin/README.md` and `apps/luwin/CLAUDE.md`: the suite lines from Step 2
- `apps/luwin/docs/nas-deployment.md`: the "Moving to luwin (once)" section, which names the old folder, files and container on purpose
- `.claude/skills/version-bump/SKILL.md`: the tag sentence from Step 4
- `apps/luwin/api/luwin/config.py`, `apps/luwin/api/luwin/store/base.py` and the tests from Task 4: the old variable names and `maester.db`

Also read `git diff -- apps/luwin/docs/architecture.md apps/luwin/docs/deferred.md` once for sentences the pass made wrong, such as a "luwin" that meant the whole suite, and fix them by hand.

Then check the new docs carry no dashes the house style forbids (the UTF-8 bytes of an en or em dash; macOS grep has no `-P`): `git diff -U0 | perl -ne 'print if /\xE2\x80[\x93\x94]/'` prints nothing.

- [ ] **Step 6: Run everything**

Run: `bun run verify`
Expected: every target passes for `@luwin/api`, `@raven/core`, `@raven/server`, `@raven/web` and `scripts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
MAE: docs and runbook for the luwin and raven rename

- the root README presents the maester suite: raven, luwin and rookery
- luwin's README, CLAUDE.md and docs use the new names
- `nas-deployment.md` gains the one-time move, with counts to compare and a way back
- the version-bump skill notes that luwin's older tags are `maester-v*`
EOF
)"
```

---

### Task 6: Ship (each step needs the user's go-ahead)

**Files:** none.

**Interfaces:**
- Consumes: branches `rename-weirwood-to-raven` and `rename-agent-to-luwin`.
- Produces: two PRs, the Meleys deploy, and the `luwin-v0.3.0` release.

- [ ] **Step 1: Ask, then push and open PR 1** from `rename-weirwood-to-raven` into `main`, written with the `pr-format` skill. Its Testing section lists the counts from Task 1 Step 7 and Task 2 Step 6, the image check, and the local `weirwood.db` adoption.

- [ ] **Step 2: Ask, then push and open PR 2** from `rename-agent-to-luwin`, stacked on PR 1, with a "Deploy (one time, on Meleys)" section that links `apps/luwin/docs/nas-deployment.md#moving-to-luwin-once`. Say whether the real-model evals ran (Task 3 Step 10).

- [ ] **Step 3: After both merge, ask, then deploy** by following "Moving to luwin (once)" on Meleys. Expected: `/health` answers, the two `users` counts match, and `docker logs luwin` shows "luwin is online as ...".

- [ ] **Step 4: Ask, then release** `luwin` with the `version-bump` skill: `scripts/bump_version.sh luwin minor`, giving `luwin-v0.3.0`.
