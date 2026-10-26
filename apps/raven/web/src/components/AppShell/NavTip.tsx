import { type ReactNode, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from '@/components/AppShell/NavTip.module.scss'

type TipAnchor = { top: number; left: number }

type OnPointerEnterProps = { currentTarget: Element }

type OnFocusProps = { currentTarget: Element }

type ChildrenProps = {
  onPointerEnter: (event: OnPointerEnterProps) => void
  onPointerLeave: () => void
  onFocus: (event: OnFocusProps) => void
  onBlur: () => void
}

type NavTipProps = {
  text: string
  isOn: boolean
  children: (handlers: ChildrenProps) => ReactNode
}

/**
 * Shows `text` beside its child the moment the pointer or focus lands on it,
 * which the browser's own `title` never does (it waits a beat). It renders
 * into the body: the side menu scrolls and so clips anything inside it. Only
 * the eye needs it; the child already carries the name for screen readers.
 */
export const NavTip = ({ text, isOn, children }: NavTipProps) => {
  const [anchor, setAnchor] = useState<TipAnchor | null>(null)
  type ShowProps = { currentTarget: Element }

  const show = ({ currentTarget }: ShowProps) => {
    const rect = currentTarget.getBoundingClientRect()
    setAnchor({ top: rect.top + rect.height / 2, left: rect.right })
  }
  const hide = () => setAnchor(null)
  return (
    <>
      {children({ onPointerEnter: show, onPointerLeave: hide, onFocus: show, onBlur: hide })}
      {isOn &&
        !!anchor &&
        createPortal(
          <span className={styles.tip} style={anchor} aria-hidden="true">
            {text}
          </span>,
          document.body,
        )}
    </>
  )
}
