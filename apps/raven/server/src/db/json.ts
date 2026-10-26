import type { Guard } from '@raven/core'

type ParseJsonAsProps<T> = { json: string; guard: Guard<T> }

/** A JSON column's value as `guard` reads it; null when it no longer parses, or no longer passes. */
export const parseJsonAs = <T>({ json, guard }: ParseJsonAsProps<T>): T | null => {
  try {
    const parsed: unknown = JSON.parse(json)
    return guard(parsed) ? parsed : null
  } catch {
    return null
  }
}
