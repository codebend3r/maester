import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '@/components/Icon/Icon'
import styles from '@/components/Button/Button.module.scss'

export type ButtonTone = 'primary' | 'quiet' | 'danger'

/** A caller's className adds placement (grid area, alignment) on top of the button's own look. */
const classes = ({
  tone,
  iconOnly,
  extra,
}: {
  tone: ButtonTone
  iconOnly: boolean
  extra: string | undefined
}): string =>
  [styles.button, styles[tone], iconOnly ? styles.iconOnly : '', extra ?? '']
    .filter(Boolean)
    .join(' ')

type Shared = {
  tone?: ButtonTone
  icon?: IconName
  children?: ReactNode
}

/** A button with an optional leading icon. Icon-only buttons must pass an aria-label. */
export const Button = ({
  tone = 'quiet',
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: Shared & ComponentProps<'button'>) => (
  <button
    type={type}
    className={classes({ tone, iconOnly: !children, extra: className })}
    {...rest}
  >
    {!!icon && <Icon name={icon} />}
    {children}
  </button>
)

/** A router link that looks like a button, for actions that are really navigation. */
export const ButtonLink = ({
  tone = 'quiet',
  icon,
  children,
  className,
  ...rest
}: Shared & ComponentProps<typeof Link>) => (
  <Link className={classes({ tone, iconOnly: !children, extra: className })} {...rest}>
    {!!icon && <Icon name={icon} />}
    {children}
  </Link>
)
