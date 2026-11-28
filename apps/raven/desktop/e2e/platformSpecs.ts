import { DESKTOP_PLATFORMS, type DesktopPlatform } from '@raven/core'

/**
 * The specs only one system can run, by file name under `e2e/`; every other spec runs on both.
 * `playwright.config.ts` leaves out the other system's.
 */
export const PLATFORM_SPECS = {
  /*
   * `hardened.e2e.ts` signs a copy of Electron.app with `codesign` and plays under macOS's
   * hardened runtime, which kills a process for an untagged executable page. Windows has
   * neither the tool nor the rule.
   */
  [DESKTOP_PLATFORMS.mac]: ['hardened.e2e.ts'],
  /*
   * `windowsChrome.e2e.ts` covers what only Windows has: a frameless window whose controls the
   * page draws, the computer called a PC, and a link handed over as an argument.
   */
  [DESKTOP_PLATFORMS.windows]: ['windowsChrome.e2e.ts'],
} as const satisfies Record<DesktopPlatform, readonly string[]>

type IgnoredSpecsForProps = {
  /** The system the suite runs on. */
  platform: DesktopPlatform
}

/** Playwright's `testIgnore` on a system: the specs that belong to the other one. */
export const ignoredSpecsFor = ({ platform }: IgnoredSpecsForProps): string[] =>
  Object.values(DESKTOP_PLATFORMS)
    .filter((other) => other !== platform)
    .flatMap((other) => PLATFORM_SPECS[other].map((spec) => `**/${spec}`))
