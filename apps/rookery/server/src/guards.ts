/** A JSON object: what a request body or a plex.tv answer has to be before a field is read off it. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value)
