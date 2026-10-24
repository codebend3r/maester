# The ✅ Checks job's toolchain (.github/workflows/pull-request-checks.yml):
# Ubuntu 24.04 with Bun, Node, uv and ffmpeg. Built and run by scripts/ci_docker.sh.
FROM ubuntu:24.04

ARG BUN_VERSION
ARG NODE_VERSION

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl ffmpeg git python3 rsync unzip xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
  && node_arch="$([ "$arch" = arm64 ] && echo arm64 || echo x64)" \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1

ENV BUN_INSTALL=/usr/local/bun
ENV PATH=/usr/local/bun/bin:/root/.local/bin:$PATH
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

RUN git config --global --add safe.directory '*'
