/**
 * Where a browser may be sent after signing in or out: a path on rookery, or
 * a URL on one of the apps in `APP_ORIGINS`. Anything else becomes
 * `fallback`, so rookery can never be used to bounce someone to a stranger's
 * site. Backslashes and control characters are refused outright, since
 * browsers read `/\evil.example` and `/<tab>/evil.example` as `//evil.example`.
 */
export const safeReturnTo = ({
  value,
  appOrigins,
  fallback,
}: {
  value: unknown
  appOrigins: readonly string[]
  fallback: string
}): string => {
  if (typeof value !== 'string' || value === '') return fallback
  // oxlint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback
  if (value.startsWith('/')) return value.startsWith('//') ? fallback : value
  try {
    const url = new URL(value)
    return appOrigins.includes(url.origin) ? url.href : fallback
  } catch {
    return fallback
  }
}
