import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { DesktopClient } from '@/renderer/desktop/client'
import type { DesktopReply } from '@/shared/protocol'

/**
 * Whether files are being dragged over the window, and the drop itself: the
 * files go to main in the order dropped, and what main answers goes to `onReply`.
 */
export const useFileDrop = ({
  client,
  onReply,
}: {
  client: DesktopClient
  onReply: (reply: DesktopReply) => void
}): boolean => {
  const [isDragging, setIsDragging] = useState(false)
  // Entering a child element fires dragenter on it before dragleave on the one
  // left, so a count, not a flag, keeps the overlay from flickering.
  const depth = useRef(0)
  const reply = useEffectEvent(onReply)

  useEffect(() => {
    // Selected text and links are dragged too; only files are a drop to play.
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current += 1
      setIsDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setIsDragging(false)
    }
    // Without preventDefault on dragover the page is not a drop target, and a
    // dropped file would navigate the window to it.
    const over = (event: DragEvent) => event.preventDefault()
    const drop = (event: DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setIsDragging(false)
      const files = [...(event.dataTransfer?.files ?? [])]
      void client.dropFiles(files).then(reply)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [client])

  return isDragging
}
