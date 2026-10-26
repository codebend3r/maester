import { useQuery } from '@tanstack/react-query'
import type { MatchItemType } from '@raven/core'
import { useEffect, useRef } from 'react'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { itemQuery, librariesQuery } from '@/lib/queries'
import styles from '@/components/ImageEditor/ImageEditor.module.scss'

type ImageEditorDialogProps = {
  itemId: number
  itemKind: MatchItemType
  onClose: () => void
}

/**
 * Edit images away from the item's page, from a card's menu: the same editor
 * in a dialog over the page, for a movie, or for an episode's show.
 */
export const ImageEditorDialog = ({ itemId, itemKind, onClose }: ImageEditorDialogProps) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const details = useQuery(itemQuery(itemId))
  const libraries = useQuery(librariesQuery)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog ref={dialog} className={styles.dialog} aria-label="Edit images" onClose={onClose}>
      {details.data ? (
        <ImageEditor
          details={details.data}
          libraries={libraries.data ?? []}
          itemKind={itemKind}
          onDone={onClose}
        />
      ) : (
        <p className={styles.waiting} role={details.isError ? 'alert' : undefined}>
          {details.isError ? details.error.message : 'Gathering the pictures'}
        </p>
      )}
    </dialog>
  )
}
