import { type ReactNode, useState } from 'react'
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from 'react-native'

import { themedStyles } from '@/theme/wrenTheme'

const useStyles = themedStyles(() => ({ fill: { flex: 1 } }))

type ListFrameProps = {
  /** The frame's look beyond filling its parent, such as the page's ground. */
  style?: StyleProp<ViewStyle>
  /** The list, given the style that sizes it. */
  children: (style: StyleProp<ViewStyle>) => ReactNode
}

/**
 * The space a `FlatList` scrolls in. On a TV build the fork wraps each list's scroller in a
 * `TVFocusGuideView` that takes no style, so Android lays out a list of `flex: 1` 2 points tall
 * and it draws nothing; this frame fills its parent, measures it and gives the list that height,
 * as raven's grid does. Until it has measured, the list fills as it would anywhere else.
 */
export function ListFrame({ style, children }: ListFrameProps) {
  const styles = useStyles()
  const [height, setHeight] = useState(0)
  const measure = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)
  return (
    <View onLayout={measure} style={[styles.fill, style]}>
      {children(height > 0 ? { height } : styles.fill)}
    </View>
  )
}
