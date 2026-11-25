import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

/** Gone from sight while keeping its room, so nothing around it moves. */
export const UNSEEN = StyleSheet.create({ unseen: { opacity: 0 } }).unseen

type UnseenProps = { isUnseen: boolean; children: ReactNode }

/** Its children kept in their place but unseen and unheard while `isUnseen`, so nothing around them moves. */
export function Unseen({ isUnseen, children }: UnseenProps) {
  return (
    <View
      accessibilityElementsHidden={isUnseen}
      importantForAccessibility={isUnseen ? 'no-hide-descendants' : 'auto'}
      style={isUnseen && UNSEEN}
    >
      {children}
    </View>
  )
}
