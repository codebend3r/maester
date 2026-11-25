import { classNames } from '@raven/ui/headless'
import { type Color, type Size, SIZES, type TokenStyle } from '@/theme/tokens'
import type { WrenIconName } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/ui/IconButton/IconButton.module.scss'

/** An icon button's ground: none, or a quiet fill. */
export const ICON_BUTTON_VARIANTS = {
  plain: 'plain',
  filled: 'filled',
} as const

type IconButtonVariant = (typeof ICON_BUTTON_VARIANTS)[keyof typeof ICON_BUTTON_VARIANTS]

type IconButtonProps = {
  icon: WrenIconName
  /** What the button is called aloud; it shows no words. */
  label: string
  onPress: () => void
  variant?: IconButtonVariant
  /** The circle's width, 36 to 76; anything under 44 still answers a 44 wide press. */
  size?: Size
  /** The icon's colour, `text2` unless the place asks for another. */
  color?: Color
  /** Fills the circle with this colour instead: the player's play button in `text`. */
  fill?: Color
  /** A larger glyph, well over half the circle: Play and Pause. */
  isProminent?: boolean
  /** The circle rides above where it sits, bleeding past the bar's top edge. */
  isLifted?: boolean
  isDisabled?: boolean
  /** A toggle's state, said aloud: Shuffle on, Like on. */
  isSelected?: boolean
}

/** A round button drawn as its icon alone, always named for a screen reader. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = ICON_BUTTON_VARIANTS.plain,
  size = SIZES.touchTarget,
  color,
  fill,
  isProminent = false,
  isLifted = false,
  isDisabled = false,
  isSelected,
}: IconButtonProps) {
  const style: TokenStyle = {
    '--button-size': size,
    '--button-ink': color,
    '--button-fill': fill,
  }
  return (
    <button
      aria-label={label}
      aria-pressed={isSelected}
      className={classNames([
        styles.button,
        styles[variant],
        isProminent && styles.prominent,
        isLifted && styles.lifted,
      ])}
      disabled={isDisabled}
      onClick={onPress}
      style={style}
      type="button"
    >
      <WrenIcon name={icon} />
    </button>
  )
}
