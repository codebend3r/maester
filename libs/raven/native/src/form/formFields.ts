import type { KeyboardTypeOptions, TextInputProps } from 'react-native'

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

/** What a field tells the system it holds, so the system can fill it. */
export type Autofill = Pick<TextInputProps, 'autoComplete' | 'textContentType'>

/*
 * The system's names for an account's two fields. With them an iPhone near an Apple TV offers
 * the saved email and password, and a password manager fills them on a phone; Apple pairs
 * `username` with `password`, whatever the account's name looks like.
 */
const AUTOFILLS = {
  email: { autoComplete: 'email', textContentType: 'username' },
  secret: { autoComplete: 'current-password', textContentType: 'password' },
  none: {},
} as const satisfies Record<string, Autofill>

type AutofillForProps = Pick<KeyboardForProps, 'isSecret' | 'isEmail'>

/** What the system may fill a field with: the account's email or its password, else nothing. */
export const autofillFor = ({ isSecret, isEmail }: AutofillForProps): Autofill => {
  if (isEmail) return AUTOFILLS.email
  return isSecret ? AUTOFILLS.secret : AUTOFILLS.none
}
