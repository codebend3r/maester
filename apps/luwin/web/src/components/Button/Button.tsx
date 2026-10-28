import type { ComponentProps } from 'react'
import styles from '@/components/Button/Button.module.scss'

export const BUTTON_TONES = { primary: 'primary', quiet: 'quiet' } as const

type ButtonTone = (typeof BUTTON_TONES)[keyof typeof BUTTON_TONES]

type ButtonProps = ComponentProps<'button'> & { tone?: ButtonTone }

/** A button in one of the page's two tones: brass for luwin's actions, quiet for the rest. */
export const Button = ({ tone = BUTTON_TONES.quiet, className, ...props }: ButtonProps) => (
  <button
    type="button"
    {...props}
    className={[styles.button, styles[tone], className].filter(Boolean).join(' ')}
  />
)
