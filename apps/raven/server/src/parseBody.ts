import { BadRequestException } from '@nestjs/common'
import type { Guard } from '@raven/core'

/**
 * A request body as the type its guard checks, the same guard the client's
 * call is typed by, or a 400 saying what was wrong with it.
 */
export const parseBody = <T>({
  guard,
  body,
  message,
}: {
  guard: Guard<T>
  body: unknown
  message: string
}): T => {
  if (!guard(body)) throw new BadRequestException(message)
  return body
}
