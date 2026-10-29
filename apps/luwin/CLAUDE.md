# Claude context for luwin

The AI assistant of the maester suite, a concierge for a private Plex server. See `README.md` here for what it does and how it is set up, `docs/architecture.md` for how it fits together, and `docs/deferred.md` for work left out of each epic.

- The Python package is `api/luwin/`, tested in `api/tests/`, with eval cases in `api/evals/cases/`. Module paths in specs and docs (`luwin/chat/service.py`) are relative to `api/`.
- Run it through Nx from the repo root: `bunx nx run @luwin/api:test`, `:lint:py`, `:format:check`, `:eval`, `:dev`.
- The chat page is `@luwin/web` in `web/`, under the root `CLAUDE.md`'s TypeScript, React and CSS rules; its tokens are in `web/src/styles/globals.scss`. Its API guards live in `web/src/lib/events.ts` and `web/src/lib/api.ts`, and must follow the shapes `api/luwin/web/chat.py` and `api/luwin/sandbox.py` send.
- `bun run sandbox:luwin` runs the page against `luwin-sandbox` (`api/luwin/sandbox.py`): the chat API over an eval case's fakes and the real raven at `RAVEN_URL` (http://localhost:5174 when unset), no sign-in, 127.0.0.1 only. It is for testing questions and answers; never wire it into the image or compose.
- Local testing calls the model through headless Claude Code on the developer's sign-in (`api/luwin/agent/claude_code.py`), never `ANTHROPIC_API_KEY`: only the deployed server uses the key. Keep the local `.env`'s key empty.
- A full `:eval` run against a real model rewrites `docs/evals.md` (tracked); commit it when it changes. Filtered and `--model fake` runs leave it alone, and CI shows the same table in the job summary.
- `:eval` is cached by Nx: it reruns only when `api/luwin/**/*.py`, `api/evals/`, `pyproject.toml`, `uv.lock` or `LUWIN_MODEL` change, and a failed run is never cached. A model set only in `.env` is not hashed, so pass `--skip-nx-cache` after changing it. The nightly CI run always skips the cache.
- The image builds from the repo root: `docker build -f apps/luwin/Dockerfile .`. `Dockerfile.dockerignore` allowlists what it copies; a new path the image needs goes there too.
- Local runs read `.env` from this folder. Copy `.env.example` here.
- Releases: the `version-bump` skill, with `luwin` as the product.
