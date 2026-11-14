import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

type Dragging = {
  /** Whether files are being dragged over Raven's window; its drop handling keeps it. */
  isDragging: boolean
}

export const useDragging = create<Dragging>()(
  devtools((): Dragging => ({ isDragging: false }), { name: 'raven/dragging' }),
)
