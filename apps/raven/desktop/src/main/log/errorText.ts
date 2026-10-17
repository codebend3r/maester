import { messageOf } from '@/shared/messageOf'

/** Node's file system errors, whose message and stack name the path they were given. */
export const isFsError = (error: unknown): error is Error & { code: string; syscall: string } =>
  error instanceof Error &&
  'code' in error &&
  typeof error.code === 'string' &&
  'syscall' in error &&
  typeof error.syscall === 'string'

/** What a thrown error says, for the log: a file system error only as its call and code. */
export const errorText = (error: unknown): string =>
  isFsError(error) ? `${error.syscall} ${error.code}` : messageOf(error)
