import { CHROMES, type Chrome } from '@/shell/chrome'
import { FORM_FACTORS, type FormFactor, SHELL_SIZES, SIZE, SPACE } from '@/theme/wrenTokens'

/** A page's padding, spread into a list's or a scroller's content style. */
export type PageInsets = {
  paddingTop: number
  paddingBottom: number
  paddingLeft: number
  paddingRight: number
}

/** The safe area's edges, as `react-native-safe-area-context` gives them. */
type SafeEdges = { top: number; bottom: number; left: number; right: number }

type PageInsetsOfProps = {
  safe: SafeEdges
  formFactor: FormFactor
  chrome: Chrome
  /** Whether a track is queued, so the mini player or the player bar sits under the page. */
  hasPlayer: boolean
}

type InsetsProps = { safe: SafeEdges; below: number }

// A phone's gutter, or a tablet's wider padding beside its sidebar.
const INSETS = {
  [FORM_FACTORS.phone]: ({ safe, below }: InsetsProps): PageInsets => ({
    paddingTop: safe.top + SPACE.s2,
    paddingBottom: below + SPACE.s6,
    paddingLeft: Math.max(safe.left, SIZE.gutter),
    paddingRight: Math.max(safe.right, SIZE.gutter),
  }),
  [FORM_FACTORS.tablet]: ({ safe, below }: InsetsProps): PageInsets => ({
    paddingTop: safe.top + SHELL_SIZES.tabletPadTop,
    paddingBottom: below + SPACE.s10,
    paddingLeft: SHELL_SIZES.tabletPadSide,
    paddingRight: Math.max(safe.right, SHELL_SIZES.tabletPadSide),
  }),
} as const satisfies Record<FormFactor, (props: InsetsProps) => PageInsets>

/**
 * Where a page's content starts and stops: below the status bar, inside the gutter, and clear
 * of what sits under it. The tab bar, the mini player and the tablet's player bar each take
 * their own room under the page and count the home indicator, so the page clears it itself only
 * when none of them is there.
 */
export const pageInsetsOf = ({
  safe,
  formFactor,
  chrome,
  hasPlayer,
}: PageInsetsOfProps): PageInsets => {
  const isClearedBelow = chrome === CHROMES.tabs || hasPlayer
  return INSETS[formFactor]({ safe, below: isClearedBelow ? 0 : safe.bottom })
}

type ToastOffsetProps = { chrome: Chrome; safeBottom: number; hasBar: boolean }

// Clear of a phone's tab bar and mini player, or of a tablet's player bar.
const TOAST_OFFSETS = {
  [FORM_FACTORS.phone]: ({ chrome, safeBottom, hasBar }: ToastOffsetProps): number => {
    const tabs = chrome === CHROMES.tabs ? SIZE.tabBar : safeBottom
    const player = hasBar ? SIZE.miniPlayer + SPACE.s2 : 0
    return tabs + player + SPACE.s4
  },
  [FORM_FACTORS.tablet]: ({ safeBottom, hasBar }: ToastOffsetProps): number =>
    (hasBar ? SHELL_SIZES.tabletPlayerBar : 0) + safeBottom + SPACE.s4,
} as const satisfies Record<FormFactor, (props: ToastOffsetProps) => number>

type ToastOffsetOfProps = Omit<PageInsetsOfProps, 'safe'> & { safeBottom: number }

/**
 * How far above the screen's foot a toast floats: clear of the tab bar on a tab, of the mini
 * player or the tablet's player bar while a track is queued, and of the home indicator where
 * none of them is there to count it.
 */
export const toastOffsetOf = ({
  formFactor,
  chrome,
  hasPlayer,
  safeBottom,
}: ToastOffsetOfProps): number =>
  TOAST_OFFSETS[formFactor]({ chrome, safeBottom, hasBar: hasPlayer && chrome !== CHROMES.bare })
