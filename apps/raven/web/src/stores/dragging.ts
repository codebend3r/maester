import { create } from 'zustand'

type Dragging = {
  /** Whether files are being dragged over raven player's window; its drop handling keeps it. */
  isDragging: boolean
}

export const useDragging = create<Dragging>()(() => ({ isDragging: false }))
