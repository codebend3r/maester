export const SMOKE_START_MS = 30_000
export const SMOKE_QUIT_MS = 5_000

export const SMOKE_STAGES = { started: 'started', quit: 'quit' } as const
export type SmokeStage = (typeof SMOKE_STAGES)[keyof typeof SMOKE_STAGES]

const ENGINE_READY = 'video engine ready: mpv v'
const ENGINE_FAILED = 'could not open its video engine'
const LAUNCH_MARK = 'raven-launch-ms '
const QUIT_MARK = 'raven-quit-ms '
const TEST_HOOK_PREFIX = 'RAVEN_DESKTOP_'

const needlesFor = ({ stage, version }: { stage: SmokeStage; version: string }): string[] => {
  const started = [`launch raven player ${version} (packaged)`, ENGINE_READY, LAUNCH_MARK]
  switch (stage) {
    case SMOKE_STAGES.started:
      return started
    case SMOKE_STAGES.quit:
      return [...started, QUIT_MARK]
    default: {
      const unreachable: never = stage
      return unreachable
    }
  }
}

/** The needles the new log lines still lack for a stage, in order: [] when the stage passed. */
export const smokeGaps = ({
  lines,
  stage,
  version,
}: {
  lines: readonly string[]
  stage: SmokeStage
  version: string
}): string[] => {
  const failure = lines.find((line) => line.includes(ENGINE_FAILED)) ?? null
  return needlesFor({ stage, version })
    .filter((needle) => !lines.some((line) => line.includes(needle)))
    .map((needle) =>
      needle === ENGINE_READY && failure !== null
        ? `the video engine did not open: ${failure}`
        : needle,
    )
}

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

const linesOf = (bytes: Uint8Array): string[] =>
  new TextDecoder()
    .decode(bytes)
    .split('\n')
    .filter((line) => line.length > 0)

/**
 * The log lines written since the live log was `from` bytes long. A live log shorter than
 * that rotated meanwhile: its old bytes moved to the first rotated file, whose rest came
 * before the new live log.
 */
export const logLinesSince = ({
  live,
  rotated,
  from,
}: {
  live: Uint8Array
  rotated: Uint8Array | null
  from: number
}): string[] => {
  if (live.length >= from) return linesOf(live.subarray(from))
  return [...linesOf(rotated?.subarray(from) ?? new Uint8Array()), ...linesOf(live)]
}
