import type { KeyboardTypeOptions } from 'react-native'

/**
 * How much a button asks for, as the web's `Button` tones: `primary` is the one action a step
 * is for, `quiet` a moss fill for another way on, and `ghost` no fill at all, for a way out.
 */
export const BUTTON_TONES = { primary: 'primary', quiet: 'quiet', ghost: 'ghost' } as const

export type ButtonTone = (typeof BUTTON_TONES)[keyof typeof BUTTON_TONES]

/** React Native's names for the keyboards a field opens. */
const KEYBOARDS = {
  digits: 'decimal-pad',
  email: 'email-address',
  plain: 'default',
  address: 'url',
} as const satisfies Record<string, KeyboardTypeOptions>

type KeyboardForProps = { isSecret: boolean; isEmail: boolean; isNumber: boolean }

/** The keyboard a field opens: digits for a number, plain for a password, a web address's otherwise. */
export const keyboardFor = ({
  isSecret,
  isEmail,
  isNumber,
}: KeyboardForProps): KeyboardTypeOptions => {
  if (isNumber) return KEYBOARDS.digits
  if (isEmail) return KEYBOARDS.email
  return isSecret ? KEYBOARDS.plain : KEYBOARDS.address
}
