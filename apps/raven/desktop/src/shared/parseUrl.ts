import type { ParsedLink } from '@raven/core'

/** WHATWG's parse of an address, which core's link readers take, or null for one it cannot parse. */
export const parseUrl = (raw: string): ParsedLink | null =>
  URL.canParse(raw) ? new URL(raw) : null
