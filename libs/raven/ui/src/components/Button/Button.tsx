import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconSize } from '@/components/Icon/Icon'
import type { IconName } from '@/components/Icon/drawings'
import styles from '@/components/Button/Button.module.scss'

/**
 * `quiet`, the default, is a moss fill; `primary` is the one action a screen
 * is for; `danger` undoes something for good; `pill` is a way back, glass over
 * whatever is behind it; `ghost` has no fill until it is pointed at.
 */
const BUTTON_TONES = {
  primary: 'primary',
  quiet: 'quiet',
  danger: 'danger',
  pill: 'pill',
  ghost: 'ghost',
} as const

export type ButtonTone = (typeof BUTTON_TONES)[keyof typeof BUTTON_TONES]

/** `large` is for the one action a page is for, as Play all is on a saga's. */
const BUTTON_SIZES = { regular: 'regular', large: 'large' } as const

export type ButtonSize = (typeof BUTTON_SIZES)[keyof typeof BUTTON_SIZES]

/** A large button's icon is in ems, so it shrinks with the button on a phone. */
const ICON_SIZES = { regular: 18, large: '1.15em' } as const satisfies Record<ButtonSize, IconSize>

type ClassesProps = {
  tone: ButtonTone
  size: ButtonSize
  iconOnly: boolean
  extra: string | undefined
}

/** A caller's className adds placement (grid area, alignment) on top of the button's own look. */
const classes = ({ tone, size, iconOnly, extra }: ClassesProps): string =>
  [
    styles.button,
    styles[tone],
    size === BUTTON_SIZES.large ? styles.large : '',
    iconOnly ? styles.iconOnly : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ')

type Shared = {
  tone?: ButtonTone
  size?: ButtonSize
  icon?: IconName
  children?: ReactNode
}

type ButtonProps = Shared & ComponentProps<'button'>

/** A button with an optional leading icon. Icon-only buttons must pass an aria-label. */
export const Button = ({
  tone = BUTTON_TONES.quiet,
  size = BUTTON_SIZES.regular,
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    className={classes({ tone, size, iconOnly: !children, extra: className })}
    {...rest}
  >
    {!!icon && <Icon name={icon} size={ICON_SIZES[size]} />}
    {children}
  </button>
)

type ButtonLinkProps = Shared & ComponentProps<typeof Link>

/** A router link that looks like a button, for actions that are really navigation. */
export const ButtonLink = ({
  tone = BUTTON_TONES.quiet,
  size = BUTTON_SIZES.regular,
  icon,
  children,
  className,
  ...rest
}: ButtonLinkProps) => (
  <Link className={classes({ tone, size, iconOnly: !children, extra: className })} {...rest}>
    {!!icon && <Icon name={icon} size={ICON_SIZES[size]} />}
    {children}
  </Link>
)
