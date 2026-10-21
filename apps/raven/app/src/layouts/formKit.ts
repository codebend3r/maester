import type { ReactNode } from 'react'
import type { KeyboardTypeOptions } from 'react-native'

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
}

/** A form's pieces, which each platform lays out and drives its own way. */
export type FormKit = {
  Form: (props: FormProps) => ReactNode
  Field: (props: FieldProps) => ReactNode
  FormButton: (props: FormButtonProps) => ReactNode
}

/** The keyboard a field opens: digits for a PIN, plain for a password, a web address's otherwise. */
export const keyboardFor = ({
  isNumeric = false,
  isSecret = false,
}: Pick<FieldProps, 'isNumeric' | 'isSecret'>): KeyboardTypeOptions => {
  if (isNumeric) return 'number-pad'
  return isSecret ? 'default' : 'url'
}
