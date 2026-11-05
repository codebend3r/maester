import {
  DEFAULT_LINK_ORIGINS,
  DEFAULT_SERVER_ORIGIN,
  DESKTOP_ENV,
  isServerOrigin,
  serverOriginOf,
} from '@raven/core'
import type { FixedServer } from '@/main/desktopConfig'

/**
 * A test hook: another Supabase Auth origin the page may call, as e2e's stand-in Auth on
 * `127.0.0.1`. Read only unpackaged; a packaged app never reads it.
 */
export const AUTH_ORIGIN_HOOK = 'RAVEN_DESKTOP_AUTH_ORIGIN'

type HookInput = {
  isPackaged: boolean
  env: Readonly<Record<string, string | undefined>>
  warn: (message: string) => void
}

/** A test hook's value: what an unpackaged run's environment names, else ''. */
const hookOf = ({ isPackaged, env, name }: Omit<HookInput, 'warn'> & { name: string }): string =>
  isPackaged ? '' : (env[name] ?? '')

/**
 * The server `/api` goes to: the one the build names, which an unpackaged run may replace
 * from the environment (a test hook; a packaged app never reads it), else the local server.
 */
export const serverOriginFrom = ({
  isPackaged,
  built,
  env,
  warn,
}: HookInput & { built: string | undefined }): string => {
  const hook = hookOf({ isPackaged, env, name: DESKTOP_ENV.serverOrigin })
  if (isServerOrigin(hook)) return hook
  if (hook !== '') {
    warn(`Raven ignored ${DESKTOP_ENV.serverOrigin}: it is not an http or https origin.`)
  }
  if (isServerOrigin(built)) return built
  if ((built ?? '') !== '') {
    warn(
      `Raven was built with a ${DESKTOP_ENV.serverOrigin} that is not an http or https origin, so it uses ${DEFAULT_SERVER_ORIGIN}.`,
    )
  }
  return DEFAULT_SERVER_ORIGIN
}

/**
 * The test hook's Supabase Auth origin when an unpackaged run names one, else null. One that is
 * not an http or https origin is ignored, with a warning.
 */
export const authOriginFrom = ({ isPackaged, env, warn }: HookInput): string | null => {
  const hook = hookOf({ isPackaged, env, name: AUTH_ORIGIN_HOOK })
  if (isServerOrigin(hook)) return hook
  if (hook !== '') warn(`Raven ignored ${AUTH_ORIGIN_HOOK}: it is not an http or https origin.`)
  return null
}

/**
 * The other origins whose `raven://` links name the server: a LAN address beside the public
 * name, say. The build's comma separated list, which an unpackaged run may replace from the
 * environment (a test hook; a packaged app never reads it). An entry that is not an http or https
 * origin is left out, with a warning.
 */
export const linkOriginsFrom = ({
  isPackaged,
  built,
  env,
  warn,
}: HookInput & { built: string | undefined }): string[] => {
  const hook = hookOf({ isPackaged, env, name: DESKTOP_ENV.linkOrigins })
  const listed = (hook === '' ? (built ?? '') : hook)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  const origins = listed.map(serverOriginOf)
  const ignored = origins.filter((origin) => origin === null).length
  if (ignored > 0) {
    warn(`Raven ignored ${ignored} of ${DESKTOP_ENV.linkOrigins}: not http or https origins.`)
  }
  return [...new Set(origins.filter((origin) => origin !== null))]
}

type FixedServerFromProps = { origin: string; linkOrigins: readonly string[] }

/**
 * The server a build plays from, with the origins its links may name it by. The default server
 * also answers to the web app's site (`DEFAULT_LINK_ORIGINS`), whose watch pages name it; another
 * server has only the aliases the build or the hook names.
 */
export const fixedServerFrom = ({ origin, linkOrigins }: FixedServerFromProps): FixedServer => {
  const isDefault = origin === DEFAULT_SERVER_ORIGIN
  const builtIn: readonly string[] = isDefault ? DEFAULT_LINK_ORIGINS : []
  return {
    origin,
    aliases: [...new Set([...builtIn, ...linkOrigins])].filter((alias) => alias !== origin),
  }
}
