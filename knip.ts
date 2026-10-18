import type { KnipConfig } from 'knip'

// knip finds the dead code CLAUDE.md forbids: files no entry point reaches,
// exports and types nothing imports, dependencies nothing uses. It runs as the
// root project's `dead-code` target, so in `verify`, `affected` and the PR
// checks. Each workspace's entry points come from its package.json, its test
// files and the plugins knip ships for vite, playwright, nest and bun.
export default {
  // The binaries package.json scripts call that no package provides: uv and uvx
  // come from the Python toolchain, pgrep from the OS.
  ignoreBinaries: ['uv', 'uvx', 'pgrep'],
  workspaces: {
    'apps/raven/desktop': {
      // Electron's main and preload bundles and the Forge config are entry
      // points no import names.
      entry: ['src/main/main.ts', 'src/preload/preload.ts', 'forge.config.ts'],
    },
    'libs/raven/mpv': {
      // The native build consumes both: node-addon-api is the addon's C++
      // header set, and buildAddon.ts spawns cmake-js by name.
      ignoreDependencies: ['node-addon-api', 'cmake-js'],
    },
  },
} satisfies KnipConfig
