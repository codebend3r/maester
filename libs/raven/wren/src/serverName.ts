import { cleanName, isString, nullable } from '@raven/core'

/** The name a listener gave their server in Settings; null until one is, which wears the server's own. */
export const isServerNamePick = nullable(isString)

/** What typing in Settings' name field comes to: refused, or the name to keep, null when cleared. */
type ServerNameEdit = { isRefused: true } | { isRefused: false; serverName: string | null }

/** What the text typed means: blank clears the name, a clean name is kept, anything else is refused. */
export const serverNameEditOf = (text: string): ServerNameEdit => {
  if (text.trim() === '') return { isRefused: false, serverName: null }
  const serverName = cleanName(text)
  return serverName === null ? { isRefused: true } : { isRefused: false, serverName }
}
