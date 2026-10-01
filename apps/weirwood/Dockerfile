# One image: the media server, which also serves the built web app, so there
# is a single port and no CORS. Built from the repo root because the server
# and the web app both depend on libs/core through the bun workspace.
#
# Bun installs and builds; Node runs, since that is the runtime NestJS
# supports. Bun is installed at the version the root package.json pins in
# `packageManager`, so the pin lives in one place.

FROM node:24-slim AS bun
WORKDIR /repo
COPY package.json bun.lock ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")"
COPY libs/core/package.json libs/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

FROM bun AS build
RUN bun install --frozen-lockfile --ignore-scripts
COPY libs/core/ libs/core/
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/
RUN cd libs/core && bun run build \
 && cd ../../apps/server && bun run build \
 && cd ../web && bun run build

FROM bun AS deps
RUN bun install --frozen-lockfile --ignore-scripts --production --filter server

FROM node:24-slim
# Debian's ffmpeg is built with zimg, so HDR thumbnails are tone mapped to
# SDR instead of coming out grey. It is only used for probing and
# thumbnails; playback never touches it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /config /media \
 && chown node:node /config
ENV NODE_ENV=production \
    PORT=8484 \
    DATA_DIR=/config \
    WEB_DIR=/app/web \
    BROWSE_ROOT=/media
WORKDIR /repo
COPY --from=deps /repo ./
COPY --from=build /repo/libs/core/dist libs/core/dist
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/web/dist /app/web
WORKDIR /repo/apps/server
USER node
EXPOSE 8484
VOLUME /config
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8484/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
