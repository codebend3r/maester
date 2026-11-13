import { matchPath, useLocation } from 'react-router-dom'
import { APP_PATHS } from '@/lib/appPaths'

/** A library's own pages, `:id` for any library's: its videos, its other tabs, its history and its sagas. */
export const libraryPages = (id: number | string): string[] => {
  const library = `${APP_PATHS.libraries}/${id}`
  return [library, `${library}/:page`, `${library}/sagas/:saga`]
}

type IsAnyOfProps = {
  patterns: readonly string[]
  pathname: string
}

/** Whether `pathname` is one of the pages `patterns` describe. */
export const isAnyOf = ({ patterns, pathname }: IsAnyOfProps): boolean =>
  patterns.some((pattern) => matchPath(pattern, pathname) != null)

/** Whether the page open now is one of those `patterns` describe, so its link is marked as current. */
export const useIsCurrent = (patterns: readonly string[]): boolean => {
  const { pathname } = useLocation()
  return isAnyOf({ patterns, pathname })
}
