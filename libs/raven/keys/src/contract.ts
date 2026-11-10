import { type Infer, isBoolean, isString, object } from '@raven/core'

/** One press of the hardware keyboard as native reports it: the web's `KeyboardEvent.key` name and the modifiers held. */
export const isKeyDown = object({
  key: isString,
  isShift: isBoolean,
  isMeta: isBoolean,
})

export type KeyDown = Infer<typeof isKeyDown>
