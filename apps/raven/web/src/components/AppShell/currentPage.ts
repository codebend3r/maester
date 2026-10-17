import { matchPath, useLocation } from 'react-router-dom'

/** A library's own pages: its videos, its other tabs, its history and its sagas. */
export const libraryPages = (id: number | string): string[] => [
  `/libraries/${id}`,
  `/libraries/${id}/:page`,
  `/libraries/${id}/sagas/:saga`,
]

/** Whether `pathname` is one of the pages `patterns` describe. */
export const isAnyOf = ({
  patterns,
  pathname,
}: {
  patterns: readonly string[]
  pathname: string
}): boolean => patterns.some((pattern) => matchPath(pattern, pathname) != null)

/** Whether the page open now is one of those `patterns` describe, so its link is marked as current. */
export const useIsCurrent = (patterns: readonly string[]): boolean => {
  const { pathname } = useLocation()
  return isAnyOf({ patterns, pathname })
}
