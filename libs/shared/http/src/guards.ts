/** A JSON object: what a body or an answer has to be before a field is read off it. Arrays are not records. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
