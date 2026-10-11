/** What went wrong, as text: an error's message, or whatever was thrown. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
