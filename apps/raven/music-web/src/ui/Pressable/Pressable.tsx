import { KeyedView, type ViewOf, type ViewsOf, classNames } from '@raven/ui/headless'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from '@/ui/Pressable/Pressable.module.scss'

/** A place a press goes to, as a link a browser can open in a tab of its own. */
type LinkPressTarget = {
  href: string
  /** What else the press does on the way. */
  onPress?: () => void
}

/** Something a press does here. */
type ButtonPressTarget = { href?: undefined; onPress: () => void }

/** What a press does: a real link to `href`, or `onPress` alone. With both, the link also tells `onPress`. */
export type Press = LinkPressTarget | ButtonPressTarget

/** A press that can be off for now, which only a button can be: a link always goes somewhere. */
export type DisablablePress = LinkPressTarget | (ButtonPressTarget & { isDisabled?: boolean })

type PressableBase = {
  /** What it is called aloud, when its words on screen say less. */
  label?: string
  className?: string
  /** Whether it is the page showing or the thing chosen, said aloud. */
  isCurrent?: boolean
  children: ReactNode
}

type LinkPressProps = PressableBase &
  LinkPressTarget & {
    /** Whether the page it opens takes this one's place in the history, so Back skips this one. */
    shouldReplace?: boolean
  }

type ButtonPressProps = PressableBase &
  ButtonPressTarget & {
    /** Whether a press does nothing for now, said by the browser and shown dimmed. */
    isDisabled?: boolean
    /** A toggle's state, said aloud; left out for a button that holds none. */
    isPressed?: boolean
  }

type PressableProps = LinkPressProps | ButtonPressProps

/** What `aria-current` says of a link to the page showing, and of the chosen one of a set. */
const CURRENT = { page: 'page', true: 'true' } as const

/** A place a press goes to: a link, so the browser's own gestures work on it. */
function LinkPress({
  href,
  onPress,
  label,
  className,
  isCurrent,
  shouldReplace,
  children,
}: LinkPressProps) {
  return (
    <Link
      aria-current={isCurrent ? CURRENT.page : undefined}
      aria-label={label}
      className={classNames([styles.pressable, className])}
      onClick={onPress}
      replace={shouldReplace}
      to={href}
    >
      {children}
    </Link>
  )
}

/** Something a press does here: a button. */
function ButtonPress({
  onPress,
  label,
  className,
  isCurrent,
  isDisabled = false,
  isPressed,
  children,
}: ButtonPressProps) {
  return (
    <button
      aria-current={isCurrent ? CURRENT.true : undefined}
      aria-label={label}
      aria-pressed={isPressed}
      className={classNames([styles.pressable, className])}
      disabled={isDisabled}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  )
}

/** Whether a press goes somewhere or acts here. */
const PRESS_KINDS = { link: 'link', button: 'button' } as const

type PressProps = {
  [PRESS_KINDS.link]: LinkPressProps
  [PRESS_KINDS.button]: ButtonPressProps
}

const PRESS_VIEWS = {
  [PRESS_KINDS.link]: LinkPress,
  [PRESS_KINDS.button]: ButtonPress,
} as const satisfies ViewsOf<PressProps>

const isLinkPress = (props: PressableProps): props is LinkPressProps => props.href !== undefined

const viewOf = (props: PressableProps): ViewOf<PressProps> =>
  isLinkPress(props) ? { key: PRESS_KINDS.link, props } : { key: PRESS_KINDS.button, props }

/**
 * What every row, tile and link of the kit is pressed through: a link when it has somewhere to
 * go, a button when it acts, faint while held, as the apps' controls answer a finger.
 */
export function Pressable(props: PressableProps) {
  return <KeyedView<PressProps> view={viewOf(props)} views={PRESS_VIEWS} />
}
