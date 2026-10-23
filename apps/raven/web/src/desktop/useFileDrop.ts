import type { DesktopReply } from '@raven/core'
import { useEffect, useEffectEvent, useRef } from 'react'
import type { DesktopClient } from '@/desktop/client'
import { useDragging } from '@/stores/dragging'

/** `DataTransfer.types` names a drag of files this way; the DOM types it as a plain string. */
const DRAG_TYPES = { files: 'Files' } as const

const setIsDragging = (isDragging: boolean) => useDragging.setState({ isDragging })

/**
 * Whether files are being dragged over the window, kept in `useDragging`, and the drop itself:
 * the files go to main in the order dropped, and what main answers goes to `onReply`.
 */
export const useFileDrop = ({
  client,
  onReply,
}: {
  client: DesktopClient
  onReply: (reply: DesktopReply) => void
}) => {
  // Entering a child element fires dragenter on it before dragleave on the one left, so a
  // count, not a flag, keeps the drop zone from flickering.
  const depth = useRef(0)
  const reply = useEffectEvent(onReply)

  // Unmounted mid-drag, the count goes, so the flag goes too.
  useEffect(
    () => () => {
      setIsDragging(false)
    },
    [],
  )

  useEffect(() => {
    // Selected text and links are dragged too; only files are a drop to play.
    const hasFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes(DRAG_TYPES.files) ?? false
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
    // Without preventDefault on dragover the page is no drop target, and a dropped file would
    // navigate the window to it.
    const over = (event: DragEvent) => event.preventDefault()
    const drop = (event: DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setIsDragging(false)
      const files = [...(event.dataTransfer?.files ?? [])]
      client
        .dropFiles(files)
        .then(reply)
        .catch(() => undefined)
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
}
