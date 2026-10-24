import type { ReactNode } from 'react'
import type { KeyboardTypeOptions } from 'react-native'

import type { FormStyles } from '@/layouts/formStyles'

export type FormProps = { title: string; children: ReactNode }

export type FieldProps = {
  label: string
  value: string
  onChangeText: (text: string) => void
  /** Gets the text the keyboard sent, which a fast typist's last keys may not have reached `value` with yet. */
  onSubmit: (input: { text: string }) => void
  placeholder?: string
  isSecret?: boolean
  isNumeric?: boolean
  /** An email address: the keyboard with `@` on it. */
  isEmail?: boolean
  /** The field the screen opens on: focused first, on a TV by the remote. */
  isFirst?: boolean
}

/**
 * How much a button asks for, as the web's `Button` tones: `primary` is the one action a step
 * is for, `quiet` a moss fill for another way on, and `ghost` no fill at all, for a way out.
 */
export const BUTTON_TONES = { primary: 'primary', quiet: 'quiet', ghost: 'ghost' } as const

export type ButtonTone = (typeof BUTTON_TONES)[keyof typeof BUTTON_TONES]

export type FormButtonProps = {
  label: string
  onPress: () => void
  tone: ButtonTone
  isDisabled?: boolean
  /** The button a step with no field opens on: on a TV the remote's, once, as it is drawn. */
  isPreferred?: boolean
}

/**
 * A question a step must have answered before it goes on: `question` is what is asked,
 * `detail` why it matters, `yesLabel` the answer that goes ahead and `noLabel` the one that
 * changes nothing, which is the default. `onAnswer` hears the answer once.
 */
export type ConfirmProps = {
  title: string
  question: string
  detail: string
  yesLabel: string
  noLabel: string
  onAnswer: (input: { isYes: boolean }) => void
}

/**
 * A step drawn over the screen it came from, which `onClose` takes the viewer back to: on a TV
 * as Menu or Back does, rather than leave the screen; under the thumb the step itself, whose
 * own button goes back.
 */
export type FormSheetProps = { onClose: () => void; children: ReactNode }

/**
 * The server's own web pages a step points to (Create account, Forgot password). Under the
 * thumb each is a button that opens the browser; a TV has no browser to open on Apple TV, so it
 * draws `note` instead, saying where to go on another device.
 */
export type WebPagesProps = {
  pages: readonly { label: string; onOpen: () => void }[]
  note: string
}

/**
 * A form's pieces, which each platform lays out and drives its own way, and the hook for its
 * styles at the platform's scale in the theme worn now, whose lines (`note`, `notice`,
 * `error`) the screens draw. `Confirm` asks a yes or no: the system's alert under the thumb,
 * a step of the form on a TV.
 */
export type FormKit = {
  Form: (props: FormProps) => ReactNode
  Field: (props: FieldProps) => ReactNode
  FormButton: (props: FormButtonProps) => ReactNode
  Confirm: (props: ConfirmProps) => ReactNode
  FormSheet: (props: FormSheetProps) => ReactNode
  WebPages: (props: WebPagesProps) => ReactNode
  useFormStyles: () => FormStyles
}

/**
 * The keyboard a field opens: digits for a PIN, plain for a password, an email address's for
 * one, a web address's otherwise.
 */
export const keyboardFor = ({
  isNumeric = false,
  isSecret = false,
  isEmail = false,
}: Pick<FieldProps, 'isNumeric' | 'isSecret' | 'isEmail'>): KeyboardTypeOptions => {
  if (isNumeric) return 'number-pad'
  if (isEmail) return 'email-address'
  return isSecret ? 'default' : 'url'
}
