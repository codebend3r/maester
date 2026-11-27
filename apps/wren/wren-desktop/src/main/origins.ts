import { DEFAULT_SERVER_ORIGIN, isServerOrigin } from '@raven/core'

/** The environment variable a build names its server in, and an unpackaged run may replace it from. */
export const SERVER_ORIGIN_ENV = 'WREN_DESKTOP_SERVER_ORIGIN'

type ServerOriginFromProps = {
  isPackaged: boolean
  /** What the build put in, '' when it named none. */
  built: string | undefined
  env: Readonly<Record<string, string | undefined>>
  warn: (message: string) => void
}

/**
 * The raven `/api` goes to: the one an unpackaged run's environment names (a test hook; a packaged
 * app never reads it), else the one the build names, else raven's public origin, so Wren for Mac
 * signs in to the same accounts as the web and the phones wherever the Mac is.
 */
export const serverOriginFrom = ({
  isPackaged,
  built,
  env,
  warn,
}: ServerOriginFromProps): string => {
  const hook = isPackaged ? '' : (env[SERVER_ORIGIN_ENV] ?? '')
  if (isServerOrigin(hook)) return hook
  if (hook !== '') warn(`Wren ignored ${SERVER_ORIGIN_ENV}: it is not an http or https origin.`)
  if (isServerOrigin(built)) return built
  if ((built ?? '') !== '') {
    warn(
      `Wren was built with a ${SERVER_ORIGIN_ENV} that is not an http or https origin, so it uses ${DEFAULT_SERVER_ORIGIN}.`,
    )
  }
  return DEFAULT_SERVER_ORIGIN
}
