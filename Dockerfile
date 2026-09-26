FROM python:3.12-slim AS base

# ffprobe/ffmpeg for the file health check (E4.3); read-only media mounts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

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
