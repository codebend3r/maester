/** The codes a Node system error carries that a desktop app's main process tells apart. */
export const ERROR_CODES = {
  addressInUse: 'EADDRINUSE',
  addressNotAvailable: 'EADDRNOTAVAIL',
  familyNotSupported: 'EAFNOSUPPORT',
} as const

/** The `code` a Node system error carries; null for an error without one, or anything else thrown. */
export const errorCodeOf = (error: unknown): string | null =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null

/** What a thrown error says, for the log and the dialogs. */
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message || error.name : String(error)

/** Whether a listen failed because another app holds the port. */
export const isPortTaken = (error: unknown): boolean =>
  errorCodeOf(error) === ERROR_CODES.addressInUse
