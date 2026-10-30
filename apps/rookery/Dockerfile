# syntax=docker/dockerfile:1
# One image: the sign-in server, which also serves the built web app, so
# there is a single port. Built from the repo root because the bun workspace,
# its lockfile and libs/shared/server live there.
#
# Bun installs and builds; Node runs, since that is the runtime NestJS
# supports. Bun is installed at the version the root package.json pins in
# `packageManager`, so the pin lives in one place.

FROM node:24-slim AS bun
WORKDIR /repo
COPY package.json bun.lock ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")"
# Every workspace manifest, so the frozen install sees the same workspace the
# lockfile describes; only rookery's sources are copied after this.
COPY --parents apps/*/*/package.json libs/*/*/package.json scripts/package.json ./
# The patches `patchedDependencies` names, which every install applies.
COPY patches/ patches/

FROM bun AS build
RUN bun install --frozen-lockfile --ignore-scripts
# Nx's workspace config, and the compiler options and presets every project extends.
COPY nx.json tsconfig.base.json ./
COPY tooling/ tooling/
COPY libs/shared/server/ libs/shared/server/
COPY apps/rookery/server/ apps/rookery/server/
COPY apps/rookery/web/ apps/rookery/web/
# Nx runs each project's own `build`, in the order the workspace graph gives.
RUN NX_DAEMON=false NX_NO_CLOUD=true bunx nx run-many -t build -p @rookery/server @rookery/web

FROM bun AS deps
RUN bun install --frozen-lockfile --ignore-scripts --production --filter @rookery/server

FROM node:24-slim
RUN mkdir -p /config && chown node:node /config
ENV NODE_ENV=production \
    PORT=8030 \
    DATA_DIR=/config \
    WEB_DIR=/app/web
WORKDIR /repo
COPY --from=deps /repo ./
COPY --from=build /repo/libs/shared/server/dist libs/shared/server/dist
COPY --from=build /repo/apps/rookery/server/dist apps/rookery/server/dist
COPY --from=build /repo/apps/rookery/web/dist /app/web
WORKDIR /repo/apps/rookery/server
USER node
EXPOSE 8030
VOLUME /config
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8030/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
