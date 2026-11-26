import { useRoute } from 'expo-router'
import type { ComponentType, ReactNode } from 'react'
import { View } from 'react-native'

import { useShelfBand } from '@/layouts/focus'
import { useFarShelfHeight } from '@/stores/shelfBands'

/** What a slot draws: its shelf, or the room the shelf takes while it is far from the view. */
const SLOT_VIEWS = { drawn: 'drawn', far: 'far' } as const

type SlotView = (typeof SLOT_VIEWS)[keyof typeof SLOT_VIEWS]

type SlotBodyProps = { height: number; children: ReactNode }

const DrawnShelf = ({ children }: SlotBodyProps) => children

const FarShelf = ({ height }: SlotBodyProps) => <View style={{ height }} />

const SLOT_BODIES = {
  [SLOT_VIEWS.drawn]: DrawnShelf,
  [SLOT_VIEWS.far]: FarShelf,
} as const satisfies Record<SlotView, ComponentType<SlotBodyProps>>

type ShelfSlotProps = {
  /** The shelf's key on its screen, which its cards name too. */
  shelf: string
  children: ReactNode
}

/**
 * Where one of a TV screen's shelves stands among the others: it says where the shelf is laid
 * out (`useShelfBand`) and, while the shelf lies far from the view, draws an empty box its
 * height in its place, so nothing above or below moves. Home's window of shelves only grows, and
 * on the Google TV Streamer every shelf kept drawn above the view slowed each move of the remote
 * the further down Home it went; a shelf is drawn again, from its first card, as it comes near.
 */
export const ShelfSlot = ({ shelf, children }: ShelfSlotProps) => {
  const screen = useRoute().key
  const band = useShelfBand(shelf)
  const farHeight = useFarShelfHeight({ screen, shelf })
  const Body = SLOT_BODIES[farHeight === null ? SLOT_VIEWS.drawn : SLOT_VIEWS.far]
  return (
    <View onLayout={band.onLayout}>
      <Body height={farHeight ?? 0}>{children}</Body>
    </View>
  )
}
