import type { Guard } from '@raven/core'

/** A JSON column's value as `guard` reads it; null when it no longer parses, or no longer passes. */
export const parseJsonAs = <T>({ json, guard }: { json: string; guard: Guard<T> }): T | null => {
  try {
    const parsed: unknown = JSON.parse(json)
    return guard(parsed) ? parsed : null
  } catch {
    return null
  }
}
