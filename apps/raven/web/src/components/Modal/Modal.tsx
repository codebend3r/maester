import { type ReactNode, useId, useState } from 'react'
import { Button, type IconName } from '@raven/ui'
import { MODAL_COPY } from '@/components/Modal/copy'
import styles from '@/components/Modal/Modal.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { useModal } from '@/lib/useModal'

/** The two sizes a modal has: its own, framed over the page, or the whole window. */
const MODAL_SIZES = { framed: 'framed', full: 'full' } as const

type ModalSize = (typeof MODAL_SIZES)[keyof typeof MODAL_SIZES]

type SizeLook = {
  className: string
  /** The size button's drawing, its name, and whether it reads as pressed. */
  icon: IconName
  label: string
  isPressed: boolean
  /** The size the button switches to. */
  next: ModalSize
}

const SIZE_LOOKS = {
  [MODAL_SIZES.framed]: {
    className: styles.modal,
    icon: 'fullscreen',
    label: MODAL_COPY.fullScreen,
    isPressed: false,
    next: MODAL_SIZES.full,
  },
  [MODAL_SIZES.full]: {
    className: `${styles.modal} ${styles.full}`,
    icon: 'fullscreenExit',
    label: MODAL_COPY.leaveFullScreen,
    isPressed: true,
    next: MODAL_SIZES.framed,
  },
} as const satisfies Record<ModalSize, SizeLook>

type ModalProps = {
  /** The heading over the body, which also names the dialog. */
  title: string
  /** Heard on every way out: the X, Escape, or the dialog closing itself. */
  onClose: () => void
  children: ReactNode
}

/**
 * A modal dialog at a size of its own, with the X on the left of its header
 * and Full screen on the right, which fills the window and back. It opens as
 * it mounts and makes the page behind it inert, so only one is ever open:
 * the page's other buttons cannot be pressed until it closes.
 */
export const Modal = ({ title, onClose, children }: ModalProps) => {
  const headingId = useId()
  const { dialog, close, keepKeys } = useModal()
  const [size, setSize] = useState<ModalSize>(MODAL_SIZES.framed)
  const look = SIZE_LOOKS[size]

  return (
    <dialog
      ref={dialog}
      className={look.className}
      aria-labelledby={headingId}
      onClose={onClose}
      onKeyDown={keepKeys}
    >
      <header className={styles.header}>
        <Button
          tone="ghost"
          icon="close"
          className={styles.close}
          aria-label={COMMON_COPY.close}
          onClick={close}
        />
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        <Button
          tone="ghost"
          icon={look.icon}
          className={styles.size}
          aria-label={look.label}
          aria-pressed={look.isPressed}
          onClick={() => setSize(look.next)}
        />
      </header>
      <div className={styles.body}>{children}</div>
    </dialog>
  )
}
