import { readFileSync } from 'node:fs'
import { isRecord, isString } from '@raven/core'

/** The server's own version, read once from its `package.json`. */
const versionOf = (): string => {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  return isRecord(parsed) && isString(parsed.version) ? parsed.version : '0.0.0'
}

/** The `User-Agent` raven names itself by to the music services, which ask every client to send one. */
export const RAVEN_USER_AGENT = `raven/${versionOf()} (https://github.com/codebend3r/maester)`
