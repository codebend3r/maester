/** The `code` of the Node system errors raven tells apart. */
export const ERROR_CODES = {
  eacces: 'EACCES',
  emfile: 'EMFILE',
  enoent: 'ENOENT',
  enospc: 'ENOSPC',
  eperm: 'EPERM',
  erofs: 'EROFS',
} as const

/** The `name` of the errors raven tells apart by it: `AbortSignal.timeout` aborts with a `TimeoutError`. */
export const ERROR_NAMES = { timeoutError: 'TimeoutError' } as const

/** What went wrong, as text: an error's message, or whatever was thrown. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
