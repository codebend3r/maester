/** The text of whatever was thrown, for a warning. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
