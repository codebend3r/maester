import type { ButtonTone } from '@raven/native/headless'
import type { ReactNode } from 'react'

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
  /** Takes a number, a port or a speed, from the keyboard's digits. */
  isNumber?: boolean
  /** The field the screen opens on: focused first, on a TV by the remote. */
  isFirst?: boolean
}

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
