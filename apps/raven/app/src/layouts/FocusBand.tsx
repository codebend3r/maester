import type { ReactNode } from 'react'
import { TVFocusGuideView } from 'react-native'

/**
 * A part of a TV screen the remote moves into as a whole, as a row of cards: a focus guide as
 * wide as its container, so Down or Up from anywhere above or below lands on it, on its first
 * control or on the one the remote last left there, never on a part further on that happens
 * to lie under the focus. It holds no list: the fork's guide passes no style to a list inside.
 */
export const FocusBand = ({ children }: { children: ReactNode }) => (
  <TVFocusGuideView autoFocus>{children}</TVFocusGuideView>
)
