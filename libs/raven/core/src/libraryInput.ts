import {
  isBoolean,
  isLibraryKind,
  isLibraryView,
  isMediaGroupBy,
  isMediaSort,
  isRecord,
  isString,
  isWatchedPercent,
} from '@/guards'
import type { LibraryInput, LibrarySettings } from '@/types'

export const LIBRARY_NAME_MAX = 80

export type LibraryInputResult = { ok: true; value: LibraryInput } | { ok: false; errors: string[] }

/** Trailing slashes off, but never the root itself down to ''. */
const normalisePath = (path: string): string => {
  const trimmed = path.trim()
  const stripped = trimmed.replace(/\/+$/, '')
  return stripped === '' && trimmed.startsWith('/') ? '/' : stripped
}

/** What a new library starts with, and what a library made before settings existed has. */
export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = {
  saveProgress: true,
  pinned: true,
  sort: 'title',
  view: 'grid',
  groupBy: 'resolution',
  watchedPercent: 90,
  kind: 'other',
}

/** Each setting's check, and what to say when a value fails it. */
const SETTING_CHECKS: Record<
  keyof LibrarySettings,
  { valid: (value: unknown) => boolean; problem: string }
> = {
  saveProgress: { valid: isBoolean, problem: 'Save progress must be on or off.' },
  pinned: { valid: isBoolean, problem: 'Pinned must be on or off.' },
  sort: { valid: isMediaSort, problem: 'Sort is not one of the choices.' },
  view: { valid: isLibraryView, problem: 'View is not one of the choices.' },
  groupBy: { valid: isMediaGroupBy, problem: 'Group by is not one of the choices.' },
  watchedPercent: {
    valid: isWatchedPercent,
    problem: 'Watched at must be a whole percentage from 1 to 100.',
  },
  kind: { valid: isLibraryKind, problem: 'Type is not one of the choices.' },
}

type SettingsResult = { settings: Partial<LibrarySettings>; errors: string[] }

/** The known settings that were sent, and a problem for each one that is not a valid value. */
const readSettings = (input: unknown): SettingsResult => {
  if (input === undefined) return { settings: {}, errors: [] }
  if (!isRecord(input)) return { settings: {}, errors: ['Settings must be an object.'] }
  return {
    settings: {
      ...(isBoolean(input.saveProgress) ? { saveProgress: input.saveProgress } : {}),
      ...(isBoolean(input.pinned) ? { pinned: input.pinned } : {}),
      ...(isMediaSort(input.sort) ? { sort: input.sort } : {}),
      ...(isLibraryView(input.view) ? { view: input.view } : {}),
      ...(isMediaGroupBy(input.groupBy) ? { groupBy: input.groupBy } : {}),
      ...(isWatchedPercent(input.watchedPercent) ? { watchedPercent: input.watchedPercent } : {}),
      ...(isLibraryKind(input.kind) ? { kind: input.kind } : {}),
    },
    errors: Object.entries(SETTING_CHECKS)
      .filter(([key, check]) => input[key] !== undefined && !check.valid(input[key]))
      .map(([, check]) => check.problem),
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
