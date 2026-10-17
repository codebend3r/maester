const TEST_HOOK_PREFIX = 'RAVEN_DESKTOP_'

/** The environment a person launches with: a packaged app reads no test hook, and the smoke passes none. */
export const withoutTestHooks = ({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>
}): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).flatMap(([name, value]) =>
      value === undefined || name.startsWith(TEST_HOOK_PREFIX) ? [] : [[name, value]],
    ),
  )
