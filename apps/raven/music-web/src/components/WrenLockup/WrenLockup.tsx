import { classNames } from '@raven/ui/headless'
import { WREN_LOCKUP_COPY } from '@raven/wren'
import type { ReactNode } from 'react'
import type { Color, Size, TokenStyle } from '@/theme/tokens'
import { LOCKUP_DRAWING, LOCKUP_VIEW_BOX, MARK_VIEW_BOX } from '@/theme/wrenBrand'
import styles from '@/components/WrenLockup/WrenLockup.module.scss'

type ViewBox = { x: number; y: number; width: number; height: number }

const viewBoxOf = ({ x, y, width, height }: ViewBox): string => `${x} ${y} ${width} ${height}`

/** A drawing's width over its height, which keeps its shape whichever side sizes it. */
const ratioOf = ({ width, height }: ViewBox): string => `${width} / ${height}`

/** What an inline drawing read by its name is to a screen reader. */
const IMAGE_ROLE = 'img'

/** The bird's shapes, in the lockup's and the mark's shared coordinates. */
function Bird() {
  return (
    <>
      <path d={LOCKUP_DRAWING.body} fillRule="evenodd" />
      {LOCKUP_DRAWING.parts.map((part) => (
        <path d={part} key={part} />
      ))}
      <circle {...LOCKUP_DRAWING.eye} className={styles.eye} />
    </>
  )
}

type LogoProps = {
  /** The drawing's own box, which sets its view and its shape. */
  box: ViewBox
  /** The class that says which side sizes it. */
  className: string | undefined
  size: Size
  ink?: Color
  /** Its name aloud; left out, a screen reader passes over it. */
  label?: string
  children: ReactNode
}

/** One of Wren's drawings in its box: read as an image by its name, or passed over with none. */
function Logo({ box, className, size, ink, label, children }: LogoProps) {
  const style: TokenStyle = {
    '--logo-size': size,
    '--logo-ink': ink,
    '--logo-ratio': ratioOf(box),
  }
  return (
    <svg
      aria-hidden={label === undefined ? 'true' : undefined}
      aria-label={label}
      className={classNames([styles.logo, className])}
      focusable={label === undefined ? 'false' : undefined}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an inline drawing read by its name has no img tag to be
      role={label === undefined ? undefined : IMAGE_ROLE}
      style={style}
      viewBox={viewBoxOf(box)}
    >
      {children}
    </svg>
  )
}

type WrenLockupProps = {
  /** How tall it is drawn: 44 on sign-in, 34 atop the sidebar. */
  size: Size
  /** The bird's and the name's colour; the scheme's (Bark on dark, Ink on light) unless a ground fixes it. */
  ink?: Color
}

/** Wren's mark beside its name, from the brand's lockup, read out as its name. */
export function WrenLockup({ size, ink }: WrenLockupProps) {
  return (
    <Logo
      box={LOCKUP_VIEW_BOX}
      className={styles.lockup}
      ink={ink}
      label={WREN_LOCKUP_COPY.name}
      size={size}
    >
      <Bird />
      <path d={LOCKUP_DRAWING.wordmark} />
    </Logo>
  )
}

type WrenMarkProps = {
  /** How wide it is drawn; the full cut is for 64 and up. */
  size: Size
  /** The bird's colour; the scheme's unless a ground fixes it. */
  ink?: Color
}

/**
 * Wren's mark alone, the bird without its name. It is decorative: the screen it heads names
 * Wren in words, so a screen reader passes over it.
 */
export function WrenMark({ size, ink }: WrenMarkProps) {
  return (
    <Logo box={MARK_VIEW_BOX} className={styles.mark} ink={ink} size={size}>
      <Bird />
    </Logo>
  )
}
