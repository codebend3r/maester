# Claude context for luwin

The AI assistant of the maester suite, a concierge for a private Plex server. See `README.md` here for what it does and how it is set up, `docs/architecture.md` for how it fits together, and `docs/deferred.md` for work left out of each epic.

- The Python package is `api/luwin/`, tested in `api/tests/`, with eval cases in `api/evals/cases/`. Module paths in specs and docs (`luwin/chat/service.py`) are relative to `api/`.
- Run it through Nx from the repo root: `bunx nx run @luwin/api:test`, `:lint:py`, `:format:check`, `:eval`, `:dev`.
- The image builds from the repo root: `docker build -f apps/luwin/Dockerfile .`. `Dockerfile.dockerignore` allowlists what it copies; a new path the image needs goes there too.
- Local runs read `.env` from this folder. Copy `.env.example` here.
- Releases: the `version-bump` skill, with `luwin` as the product.
