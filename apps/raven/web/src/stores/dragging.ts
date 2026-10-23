import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { STORE_KEYS } from '@/stores/storage'

type Dragging = {
  /** Whether files are being dragged over Raven's window; its drop handling keeps it. */
  isDragging: boolean
}

export const useDragging = create<Dragging>()(
  devtools(
    persist((): Dragging => ({ isDragging: false }), {
      name: STORE_KEYS.dragging,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ isDragging }) => ({ isDragging }),
    }),
    { name: 'raven/dragging' },
  ),
)
