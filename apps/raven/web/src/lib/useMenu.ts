import { KEYS } from '@raven/core'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

const ITEMS = '[role^="menuitem"]'

/**
 * A button's menu. It opens with focus on the item checked, else the first,
 * so the arrows start from it, and they go round its items. Escape, Tab or a
 * click outside `root` closes it; Escape hands focus back to the button.
 */
export const useMenu = () => {
  const [isOpen, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const close = ({ refocus }: { refocus: boolean }) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  useEffect(() => {
    if (!isOpen) return
    const items = list.current
    const first =
      items?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      items?.querySelector<HTMLElement>(ITEMS)
    first?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen])

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])
    const index = items.findIndex((item) => item === document.activeElement)
    if (event.key === KEYS.escape) {
      event.preventDefault()
      close({ refocus: true })
    } else if (event.key === KEYS.arrowDown) {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === KEYS.arrowUp) {
      event.preventDefault()
      items[index <= 0 ? items.length - 1 : index - 1]?.focus()
    } else if (event.key === KEYS.tab) {
      setOpen(false)
    }
  }

  return { isOpen, toggle: () => setOpen((now) => !now), close, root, trigger, list, onKeyDown }
}
