import {
  type LibraryInput,
  type LibrarySettings,
  isLibrarySettings,
  isLibrarySettingsChange,
} from '@/contract'
import { isRecord, isString } from '@/schema'

export const LIBRARY_NAME_MAX = 80

export type LibraryInputResult = { ok: true; value: LibraryInput } | { ok: false; errors: string[] }

/** Trailing slashes off, but never the root itself down to ''. */
const normalisePath = (path: string): string => {
  const trimmed = path.trim()
  const stripped = trimmed.replace(/\/+$/, '')
  return stripped === '' && trimmed.startsWith('/') ? '/' : stripped
}

/** What to say about each setting sent with a value it does not take. */
const SETTING_PROBLEMS = {
  saveProgress: 'Save progress must be on or off.',
  pinned: 'Pinned must be on or off.',
  sort: 'Sort is not one of the choices.',
  view: 'View is not one of the choices.',
  groupBy: 'Group by is not one of the choices.',
  watchedPercent: 'Watched at must be a whole percentage from 1 to 100.',
  kind: 'Type is not one of the choices.',
  ratingsSource: 'Ratings shown is not one of the choices.',
  autoRefresh: 'Refresh automatically must be on or off.',
  locked: 'Lock with the PIN must be on or off.',
  folderLayout: 'Folder layout is not one of the choices.',
  icon: 'Icon is not one of the choices.',
} as const satisfies Record<keyof LibrarySettings, string>

type SettingsResult = { settings: Partial<LibrarySettings>; errors: string[] }

/** The known settings that were sent, and a problem for each one that is not a valid value. */
const readSettings = (input: unknown): SettingsResult => {
  if (input === undefined) return { settings: {}, errors: [] }
  if (!isRecord(input)) return { settings: {}, errors: ['Settings must be an object.'] }
  const valid = Object.fromEntries(
    Object.entries(isLibrarySettings.shape)
      .filter(([key, guard]) => guard(input[key]))
      .map(([key]) => [key, input[key]]),
  )
  return {
    settings: isLibrarySettingsChange(valid) ? valid : {},
    errors: Object.entries(SETTING_PROBLEMS)
      .filter(
        ([key]) => input[key] !== undefined && !isLibrarySettingsChange({ [key]: input[key] }),
      )
      .map(([, problem]) => problem),
  }
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

  const settings = readSettings(input.settings)

  const errors = [
    ...(name === '' ? ['Give the library a name.'] : []),
    ...(name.length > LIBRARY_NAME_MAX
      ? [`Keep the name under ${LIBRARY_NAME_MAX} characters.`]
      : []),
    ...(paths.length === 0 ? ['Add at least one folder.'] : []),
    ...paths
      .filter((path) => !path.startsWith('/'))
      .map((path) => `"${path}" is not an absolute path.`),
    ...settings.errors,
  ]

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      name,
      paths,
      ...(input.settings === undefined ? {} : { settings: settings.settings }),
    },
  }
}
