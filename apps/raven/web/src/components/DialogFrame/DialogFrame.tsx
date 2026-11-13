import { classNames } from '@raven/ui'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import styles from '@/components/DialogFrame/DialogFrame.module.scss'

/** How wide a dialog is, from a pad of keys to a match's search. */
export const DIALOG_WIDTHS = {
  narrow: 'narrow',
  question: 'question',
  prose: 'prose',
  form: 'form',
  wideForm: 'wideForm',
} as const

type DialogWidth = (typeof DIALOG_WIDTHS)[keyof typeof DIALOG_WIDTHS]

const WIDTH_CLASSES = {
  [DIALOG_WIDTHS.narrow]: styles.narrow,
  [DIALOG_WIDTHS.question]: styles.question,
  [DIALOG_WIDTHS.prose]: styles.prose,
  [DIALOG_WIDTHS.form]: styles.form,
  [DIALOG_WIDTHS.wideForm]: styles.wideForm,
} as const satisfies Record<DialogWidth, string | undefined>

type DialogFrameProps = {
  /** The dialog `useModal` opens as it mounts. */
  dialog: RefObject<HTMLDialogElement | null>
  width: DialogWidth
  labelledBy: string
  describedBy?: string
  /** Heard on every way out: Escape, a button that closes it, or its close event. */
  onClose: () => void
  /** What a key pressed inside does: `useModal`'s `keepKeys`, unless the dialog answers keys itself. */
  onKeyDown: (event: KeyboardEvent) => void
  /** What the dialog adds to the frame's look, as a padded one does. */
  className?: string
  children: ReactNode
}

/**
 * Every modal dialog's frame: the native `<dialog>`, opened modal by
 * `useModal`, at one of the dialog widths and never wider than the screen
 * or taller than it, with no padding of its own, so the body inside lays
 * itself out. The border, fill and backdrop are the element's defaults.
 */
export const DialogFrame = ({
  dialog,
  width,
  labelledBy,
  describedBy,
  onClose,
  onKeyDown,
  className,
  children,
}: DialogFrameProps) => (
  <dialog
    ref={dialog}
    className={classNames([styles.frame, WIDTH_CLASSES[width], className])}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    onClose={onClose}
    onKeyDown={onKeyDown}
  >
    {children}
  </dialog>
)
