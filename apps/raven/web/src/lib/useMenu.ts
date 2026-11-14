import { KEYS } from '@raven/core'
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react'

const ITEMS = '[role^="menuitem"]'

type KeyAction = (event: KeyboardEvent<HTMLUListElement>) => void

type MenuItems = { items: HTMLElement[]; index: number }

/** The list's items, and where the focus is among them: -1 for none. */
const itemsOf = (list: HTMLUListElement | null): MenuItems => {
  const items = Array.from(list?.querySelectorAll<HTMLElement>(ITEMS) ?? [])
  return { items, index: items.findIndex((item) => item === document.activeElement) }
}

type UseMenuListProps = {
  isOpen: boolean
  setOpen: (isOpen: boolean) => void
  root: RefObject<HTMLDivElement | null>
  trigger: RefObject<HTMLButtonElement | null>
}

/**
 * The list of a button's menu whose open state lives elsewhere, as a card's
 * does. It opens with focus on the item checked, else the first, so the
 * arrows start from it, and they go round its items. Escape, Tab or a click
 * outside `root` closes it; Escape hands focus back to `trigger`.
 */
export const useMenuList = ({ isOpen, setOpen, root, trigger }: UseMenuListProps) => {
  const list = useRef<HTMLUListElement>(null)

  type CloseProps = { refocus: boolean }

  const close = ({ refocus }: CloseProps) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  useEffect(() => {
    if (!isOpen) return
    const menu = list.current
    const first =
      menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>(ITEMS)
    first?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen, setOpen, root])

  // What each key the list answers does; any other key is the browser's.
  const keyActions: Readonly<Record<string, KeyAction>> = {
    [KEYS.escape]: (event) => {
      event.preventDefault()
      close({ refocus: true })
    },
    [KEYS.arrowDown]: (event) => {
      event.preventDefault()
      const { items, index } = itemsOf(list.current)
      items[(index + 1) % items.length]?.focus()
    },
    [KEYS.arrowUp]: (event) => {
      event.preventDefault()
      const { items, index } = itemsOf(list.current)
      items[index <= 0 ? items.length - 1 : index - 1]?.focus()
    },
    [KEYS.tab]: () => setOpen(false),
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const action = keyActions[event.key]
    if (action) action(event)
  }

  return { list, close, onKeyDown }
}

/** A button's menu that holds its own open state, with `useMenuList`'s keys, focus and closing. */
export const useMenu = () => {
  const [isOpen, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const { list, close, onKeyDown } = useMenuList({ isOpen, setOpen, root, trigger })
  return { isOpen, toggle: () => setOpen((now) => !now), close, root, trigger, list, onKeyDown }
}
