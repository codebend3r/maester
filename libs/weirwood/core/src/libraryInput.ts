import { isRecord, isString } from './guards.js'
import type { LibraryInput } from './types.js'

export const LIBRARY_NAME_MAX = 80

export type LibraryInputResult = { ok: true; value: LibraryInput } | { ok: false; errors: string[] }

/** Trailing slashes off, but never the root itself down to ''. */
const normalisePath = (path: string): string => {
  const trimmed = path.trim()
  const stripped = trimmed.replace(/\/+$/, '')
  return stripped === '' && trimmed.startsWith('/') ? '/' : stripped
}

/**
 * Checks and tidies a library create/update body. The web form runs it to
 * show errors before submitting and the server runs it again on receipt, so
 * both enforce exactly the same rules.
 */
export const validateLibraryInput = (input: unknown): LibraryInputResult => {
  if (!isRecord(input)) return { ok: false, errors: ['Expected a library object.'] }

  const name = isString(input.name) ? input.name.trim() : ''
  const rawPaths = Array.isArray(input.paths) ? input.paths : []
  const paths = rawPaths
    .filter(isString)
    .map(normalisePath)
    .filter((path) => path !== '')
    .filter((path, index, all) => all.indexOf(path) === index)

  const errors = [
    ...(name === '' ? ['Give the library a name.'] : []),
    ...(name.length > LIBRARY_NAME_MAX
      ? [`Keep the name under ${LIBRARY_NAME_MAX} characters.`]
      : []),
    ...(paths.length === 0 ? ['Add at least one folder.'] : []),
    ...paths
      .filter((path) => !path.startsWith('/'))
      .map((path) => `"${path}" is not an absolute path.`),
  ]

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { name, paths } }
}
