# Claude context for luwin

The AI assistant of the maester suite, a concierge for a private Plex server. See `README.md` here for what it does and how it is set up, `docs/architecture.md` for how it fits together, and `docs/deferred.md` for work left out of each epic.

- The Python package is `api/luwin/`, tested in `api/tests/`, with eval cases in `api/evals/cases/`. Module paths in specs and docs (`luwin/chat/service.py`) are relative to `api/`.
- Run it through Nx from the repo root: `bunx nx run @luwin/api:test`, `:lint:py`, `:format:check`, `:eval`, `:dev`.
- A full `:eval` run against a real model rewrites `docs/evals.md` (tracked); commit it when it changes. Filtered and `--model fake` runs leave it alone, and CI shows the same table in the job summary.
- `:eval` is cached by Nx: it reruns only when `api/luwin/**/*.py`, `api/evals/`, `pyproject.toml`, `uv.lock` or `LUWIN_MODEL` change, and a failed run is never cached. A model set only in `.env` is not hashed, so pass `--skip-nx-cache` after changing it. The weekly CI run always skips the cache.
- The image builds from the repo root: `docker build -f apps/luwin/Dockerfile .`. `Dockerfile.dockerignore` allowlists what it copies; a new path the image needs goes there too.
- Local runs read `.env` from this folder. Copy `.env.example` here.
- Releases: the `version-bump` skill, with `luwin` as the product.
