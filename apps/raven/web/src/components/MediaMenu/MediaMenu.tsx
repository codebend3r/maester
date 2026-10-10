import type { UseMutationResult } from '@tanstack/react-query'
import type { MediaItem } from '@raven/core'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { Icon } from '@/components/Icon/Icon'
import { useMediaMutations } from '@/lib/useMediaMutations'
import styles from '@/components/MediaMenu/MediaMenu.module.scss'

/** Deleting is the one action here that cannot be undone, so it asks first. */
const ConfirmDelete = ({
  media,
  remove,
  onClose,
}: {
  media: MediaItem
  remove: UseMutationResult<void, Error, void>
  onClose: () => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onClose={onClose}>
      <div className={styles.dialogBody}>
        <h2 id={id} className={styles.dialogTitle}>
          Delete {media.title}?
        </h2>
        <p className={styles.hint}>This removes the file from disk. It cannot be undone.</p>
        {remove.isError && (
          <p role="alert" className={styles.error}>
            {remove.error.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="danger"
            icon="trash"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: onClose })}
          >
            Delete for good
          </Button>
        </div>
      </div>
    </dialog>
  )
}

/**
 * A card's context menu: mark or unmark a favourite, or delete the video.
 * The card owns `open`, so a right click anywhere on it opens this same
 * menu; the button here is the discoverable way in for touch and keyboard.
 */
export const MediaMenu = ({
  media,
  open,
  onOpenChange,
  inline = false,
}: {
  media: MediaItem
  open: boolean
  onOpenChange: (open: boolean) => void
  /** In a row of its own (list, tiles) instead of over a card's thumbnail. */
  inline?: boolean
}) => {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [confirming, setConfirming] = useState(false)
  const { favourite, remove } = useMediaMutations({ media })
  const label = `Options for ${media.title}`

  const items = (): HTMLButtonElement[] =>
    Array.from(list.current?.querySelectorAll('button') ?? [])

  const close = ({ refocus }: { refocus: boolean }) => {
    onOpenChange(false)
    if (refocus) trigger.current?.focus()
  }

  // Focus lands on the first item whichever way the menu opened.
  useEffect(() => {
    if (open) list.current?.querySelector('button')?.focus()
  }, [open])

  // A click or tap anywhere else closes it.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange])

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const buttons = items()
    const index = buttons.findIndex((button) => button === document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      close({ refocus: true })
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      buttons[(index + 1) % buttons.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      buttons[index <= 0 ? buttons.length - 1 : index - 1]?.focus()
    } else if (event.key === 'Tab') {
      onOpenChange(false)
    }
  }

  return (
    <div ref={root} className={inline ? `${styles.root} ${styles.inline}` : styles.root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="more" size={18} />
      </button>

      {open && (
        <ul
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className={styles.list}
          onKeyDown={onKeyDown}
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                favourite.mutate(!media.favourite)
                close({ refocus: true })
              }}
            >
              <Icon name="heart" size={16} />
              {media.favourite ? 'Remove favourite' : 'Favourite'}
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                close({ refocus: false })
                setConfirming(true)
              }}
            >
              <Icon name="trash" size={16} />
              Delete
            </button>
          </li>
        </ul>
      )}

      {confirming && (
        <ConfirmDelete
          media={media}
          remove={remove}
          onClose={() => {
            setConfirming(false)
            trigger.current?.focus()
          }}
        />
      )}
    </div>
  )
}
