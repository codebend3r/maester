import type { KnipConfig } from 'knip'

// knip finds the dead code CLAUDE.md forbids: files no entry point reaches,
// exports and types nothing imports, dependencies nothing uses. It runs as the
// root project's `dead-code` target, so in `verify`, `affected` and the PR
// checks. Each workspace's entry points come from its package.json, its test
// files and the plugins knip ships for vite, playwright, nest, bun, expo and jest.
export default {
  // The binaries package.json scripts call that no package provides: uv and uvx
  // come from the Python toolchain, pgrep from the OS.
  ignoreBinaries: ['uv', 'uvx', 'pgrep'],
  workspaces: {
    'apps/raven/app': {
      // expo-router reads each route under app/ by its path, which no import
      // names; knip's Expo plugin finds index.ts and the configs itself.
      entry: ['app/**/*.tsx'],
      // Installed on the Mac, not by bun: watchman for Metro, maestro for the e2e.
      ignoreBinaries: ['watchman', 'maestro'],
      // knip's Expo plugin expects expo-updates unless the config turns updates
      // off; the app ships no over-the-air updates and does not install it.
      // `@raven/audio` is imported only through `@raven/native`'s host, but Expo
      // autolinks a native module only from the app's own dependencies.
      ignoreDependencies: ['expo-updates', '@raven/audio'],
    },
    'apps/raven/music': {
      // Wren, read as the app is: its routes by path, the binaries the Mac installs, and no
      // over-the-air updates.
      entry: ['app/**/*.tsx'],
      ignoreBinaries: ['watchman', 'maestro'],
      ignoreDependencies: ['expo-updates'],
    },
    'apps/raven/desktop': {
      // Electron's main and preload bundles and the Forge config are entry
      // points no import names.
      entry: ['src/main/main.ts', 'src/preload/preload.ts', 'forge.config.ts'],
    },
    'apps/raven/supabase': {
      // Deno runs the Edge Functions and resolves their imports through each
      // function's deno.json, which knip does not read.
      entry: ['functions/*/index.ts', 'functions/*/*.test.ts'],
      paths: { '@/alert': ['functions/signup-alert/alert.ts'] },
      ignoreDependencies: ['nodemailer'],
    },
    'libs/raven/native': {
      // The package's three entries. Its exports name them in dist, and knip's default finds
      // only src/index.ts.
      entry: ['src/index.ts', 'src/headless.ts', 'src/polyfills.ts'],
    },
    'libs/raven/mpv': {
      // The native build consumes both: node-addon-api is the addon's C++
      // header set, and buildAddon.ts spawns cmake-js by name.
      ignoreDependencies: ['node-addon-api', 'cmake-js'],
    },
  },
} satisfies KnipConfig
