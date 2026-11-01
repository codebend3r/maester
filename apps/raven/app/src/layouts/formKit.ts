import type { ReactNode } from 'react'
import type { KeyboardTypeOptions } from 'react-native'

import type { FormStyles } from '@/layouts/formStyles'

export type FormProps = { title: string; children: ReactNode }

type OnSubmitProps = { text: string }

export type FieldProps = {
  label: string
  value: string
  onChangeText: (text: string) => void
  /** Gets the text the keyboard sent, which a fast typist's last keys may not have reached `value` with yet. */
  onSubmit: (input: OnSubmitProps) => void
  placeholder?: string
  isSecret?: boolean
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
  /** The button a step opens on, in place of its first field: on a TV, focused first by the remote. */
  isFirst?: boolean
}

/**
 * A form's pieces, which each platform lays out and drives its own way, and the hook for its
 * styles at the platform's scale in the theme worn now, whose lines (`note`, `notice`,
 * `error`) the screens draw.
 */
export type FormKit = {
  Form: (props: FormProps) => ReactNode
  Field: (props: FieldProps) => ReactNode
  FormButton: (props: FormButtonProps) => ReactNode
  useFormStyles: () => FormStyles
}

type KeyboardForProps = Pick<FieldProps, 'isSecret' | 'isEmail'>

/** The keyboard a field opens: plain for a password, a web address's otherwise. */
export const keyboardFor = ({
  isSecret = false,
  isEmail = false,
}: KeyboardForProps): KeyboardTypeOptions => {
  if (isEmail) return 'email-address'
  return isSecret ? 'default' : 'url'
}
