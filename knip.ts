import type { KnipConfig } from 'knip'

/**
 * knip finds the dead code CLAUDE.md forbids: files no entry point reaches,
 * exports and types nothing imports, dependencies nothing uses. It runs as the
 * root project's `dead-code` target, so in `verify`, `affected` and the PR
 * checks. Each workspace's entry points come from its package.json, its test
 * files and the plugins knip ships for vite, playwright, nest, bun, expo and jest.
 */
export default {
  /*
   * The binaries package.json scripts call that no package provides: uv and uvx
   * come from the Python toolchain, pgrep from the OS.
   */
  ignoreBinaries: ['uv', 'uvx', 'pgrep'],
  workspaces: {
    'apps/raven/app': {
      /*
       * expo-router reads each route under app/ by its path, which no import
       * names; knip's Expo plugin finds index.ts and the configs itself.
       */
      entry: ['app/**/*.tsx'],
      // Installed on the Mac, not by bun: watchman for Metro, maestro for the e2e.
      ignoreBinaries: ['watchman', 'maestro'],
      /*
       * knip's Expo plugin expects expo-updates unless the config turns updates
       * off; the app ships no over-the-air updates and does not install it.
       * `@raven/audio` and `expo-file-system` are imported only through
       * `@raven/native` (its music host, its downloads' disk), but Expo autolinks a
       * native module only from the app's own dependencies.
       */
      ignoreDependencies: ['expo-updates', '@raven/audio', 'expo-file-system'],
    },
    'apps/raven/music': {
      /*
       * Wren, read as the app is: its routes by path, the binaries the Mac installs, and no
       * over-the-air updates.
       */
      entry: ['app/**/*.tsx'],
      ignoreBinaries: ['watchman', 'maestro'],
      ignoreDependencies: ['expo-updates'],
    },
    'apps/raven/web': {
      /*
       * Netlify runs each function by its folder's file of the same name, and Lighthouse CI the
       * server lighthouserc.json names; no import names either.
       */
      entry: ['netlify/functions/*/*.ts', 'lighthouse/serve.ts'],
      // The Lighthouse server makes its certificate with the OS's openssl.
      ignoreBinaries: ['openssl'],
    },
    'apps/raven/desktop': {
      // Electron's main and preload bundles are entry points no import names; knip's Forge plugin finds its config.
      entry: ['src/main/main.ts', 'src/preload/preload.ts'],
    },
    'apps/raven/supabase': {
      /*
       * Deno runs the Edge Functions and resolves their imports through each
       * function's deno.json, which knip does not read.
       */
      entry: ['functions/*/index.ts', 'functions/*/*.test.ts'],
      paths: { '@/alert': ['functions/signup-alert/alert.ts'] },
      ignoreDependencies: ['nodemailer'],
    },
    'libs/raven/core': {
      // The package's two entries: the library, and the fixture server's facts its e2e suites share.
      entry: ['src/index.ts', 'src/fixtureServer.ts'],
    },
    'libs/raven/native': {
      /*
       * The package's four entries, the apps' test fixtures among them. Its exports name them in
       * dist, and knip's default finds only src/index.ts.
       */
      entry: ['src/index.ts', 'src/headless.ts', 'src/polyfills.ts', 'src/testing.ts'],
    },
    'libs/raven/mpv': {
      /*
       * The native build consumes both: node-addon-api is the addon's C++
       * header set, and buildAddon.ts spawns cmake-js by name.
       */
      ignoreDependencies: ['node-addon-api', 'cmake-js'],
    },
  },
} satisfies KnipConfig
