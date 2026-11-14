import type { ReactNode } from 'react'
import { StyleSheet, TVFocusGuideView } from 'react-native'

type FocusBandProps = {
  children: ReactNode
  /**
   * Whether the band takes the whole of its container's height, for a child that fills it
   * (`flex: 1`): sized by its content, the guide gives such a child no height, and Android,
   * which clips a view's children to it, then draws none of it.
   */
  isFilling?: boolean
}

/**
 * A part of a TV screen the remote moves into as a whole, as a row of cards: a focus guide as
 * wide as its container, so Down or Up from anywhere above or below lands on it, on its first
 * control or on the one the remote last left there, never on a part further on that happens
 * to lie under the focus. It holds no list: the fork's guide passes no style to a list inside.
 */
export const FocusBand = ({ children, isFilling = false }: FocusBandProps) => (
  <TVFocusGuideView autoFocus style={isFilling && styles.filling}>
    {children}
  </TVFocusGuideView>
)

const styles = StyleSheet.create({ filling: { flex: 1 } })
