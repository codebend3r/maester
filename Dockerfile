FROM python:3.12-slim AS base

# ffprobe/ffmpeg for the file health check (E4.3); read-only media mounts. tzdata
# so scheduled jobs (E6) run by the wall clock in TZ: slim images don't carry it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tzdata \
    && rm -rf /var/lib/apt/lists/*

# Ookla's speedtest CLI for the on-demand upload test (E5.3), pinned to 1.2.0 and
# checked against its tarball's SHA-256, so nothing is fetched when a test runs.
RUN set -eux; \
    case "$(uname -m)" in \
      x86_64) arch=x86_64; sum=5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7 ;; \
      aarch64) arch=aarch64; sum=3953d231da3783e2bf8904b6dd72767c5c6e533e163d3742fd0437affa431bd3 ;; \
      *) echo "no pinned speedtest CLI for $(uname -m)" >&2; exit 1 ;; \
    esac; \
    python -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' \
      "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-${arch}.tgz" /tmp/speedtest.tgz; \
    echo "${sum}  /tmp/speedtest.tgz" | sha256sum -c -; \
    tar -xzf /tmp/speedtest.tgz -C /usr/local/bin speedtest; \
    rm /tmp/speedtest.tgz

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1

# Dependencies first so code changes do not invalidate the layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY maester ./maester
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 1000 maester \
    && mkdir -p /data && chown maester:maester /data
USER maester
VOLUME ["/data"]
EXPOSE 8020

CMD ["maester"]
