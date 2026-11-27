import { useRoute } from 'expo-router'
import type { ReactNode } from 'react'
import { View } from 'react-native'

import { useShelfBand } from '@/layouts/focus'
import { useFarShelfHeight } from '@/stores/shelfBands'

type ShelfSlotProps = {
  /** The shelf's key on its screen, which its cards name too. */
  shelf: string
  children: ReactNode
}

/**
 * Where one of a TV screen's shelves stands among the others: it says where the shelf is laid
 * out (`useShelfBand`) and, while the shelf lies far from the view, stands empty at the shelf's
 * height, so nothing above or below moves. Home's window of shelves only grows, and on the
 * Google TV Streamer every shelf kept drawn above the view slowed each move of the remote the
 * further down Home it went; a shelf is drawn again, from its first card, as it comes near.
 */
export const ShelfSlot = ({ shelf, children }: ShelfSlotProps) => {
  const screen = useRoute().key
  const band = useShelfBand(shelf)
  const farHeight = useFarShelfHeight({ screen, shelf })
  return (
    <View onLayout={band.onLayout} style={farHeight !== null && { height: farHeight }}>
      {farHeight === null && children}
    </View>
  )
}
