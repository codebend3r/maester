import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName, type IconSize } from '@/components/Icon/Icon'
import styles from '@/components/Button/Button.module.scss'

export type ButtonTone = 'primary' | 'quiet' | 'danger'

/** `large` is for the one action a page is for, as Play all is on a saga's. */
export type ButtonSize = 'regular' | 'large'

/** A large button's icon is in ems, so it shrinks with the button on a phone. */
const ICON_SIZES = { regular: 20, large: '1.3em' } as const satisfies Record<ButtonSize, IconSize>

/** A caller's className adds placement (grid area, alignment) on top of the button's own look. */
const classes = ({
  tone,
  size,
  iconOnly,
  extra,
}: {
  tone: ButtonTone
  size: ButtonSize
  iconOnly: boolean
  extra: string | undefined
}): string =>
  [styles.button, styles[tone], styles[size], iconOnly ? styles.iconOnly : '', extra ?? '']
    .filter(Boolean)
    .join(' ')

type Shared = {
  tone?: ButtonTone
  size?: ButtonSize
  icon?: IconName
  children?: ReactNode
}

/** A button with an optional leading icon. Icon-only buttons must pass an aria-label. */
export const Button = ({
  tone = 'quiet',
  size = 'regular',
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: Shared & ComponentProps<'button'>) => (
  <button
    type={type}
    className={classes({ tone, size, iconOnly: !children, extra: className })}
    {...rest}
  >
    {!!icon && <Icon name={icon} size={ICON_SIZES[size]} />}
    {children}
  </button>
)

/** A router link that looks like a button, for actions that are really navigation. */
export const ButtonLink = ({
  tone = 'quiet',
  size = 'regular',
  icon,
  children,
  className,
  ...rest
}: Shared & ComponentProps<typeof Link>) => (
  <Link className={classes({ tone, size, iconOnly: !children, extra: className })} {...rest}>
    {!!icon && <Icon name={icon} size={ICON_SIZES[size]} />}
    {children}
  </Link>
)
