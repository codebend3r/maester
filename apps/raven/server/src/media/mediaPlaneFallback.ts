type ProxiedMediaWarningProps = {
  webOrigin: string
  hasMediaOrigins: boolean
}

/** What the log says the first time a web origin's media comes through its proxy. */
export const proxiedMediaWarning = ({
  webOrigin,
  hasMediaOrigins,
}: ProxiedMediaWarningProps): string => {
  const cause = hasMediaOrigins
    ? 'its probe reached none of RAVEN_MEDIA_ORIGINS, so check that one of them answers from where that browser is'
    : 'RAVEN_MEDIA_ORIGINS is unset'
  return `Media for ${webOrigin} is streaming through its /api proxy, which its host bills as bandwidth: ${cause}.`
}

type ProxiedMediaWarnerProps = {
  hasMediaOrigins: boolean
  warn: (message: string) => void
}

/**
 * Says so, once per web origin for the server's life, when media bytes come
 * through a web origin's `/api` proxy instead of straight from the browser:
 * the media plane hook's `onProxied`.
 */
export const proxiedMediaWarner = ({
  hasMediaOrigins,
  warn,
}: ProxiedMediaWarnerProps): ((webOrigin: string) => void) => {
  const warned = new Set<string>()
  return (webOrigin) => {
    if (warned.has(webOrigin)) return
    warned.add(webOrigin)
    warn(proxiedMediaWarning({ webOrigin, hasMediaOrigins }))
  }
}
