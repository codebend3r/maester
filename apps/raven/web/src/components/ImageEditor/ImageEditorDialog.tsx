import { useQuery } from '@tanstack/react-query'
import type { MatchItemType } from '@raven/core'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { itemQuery, librariesQuery } from '@/lib/queries'
import { useModal } from '@/lib/useModal'
import { IMAGE_EDITOR_COPY } from '@/components/ImageEditor/copy'
import styles from '@/components/ImageEditor/ImageEditor.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type ImageEditorDialogProps = {
  itemId: number
  itemKind: MatchItemType
  /** The library of the card whose menu opened it, whose pictures it starts on. */
  libraryId: number
  onClose: () => void
}

/**
 * Edit images away from the item's page, from a card's menu: the same editor
 * in a dialog over the page, for a movie, or for an episode's show.
 */
export const ImageEditorDialog = ({
  itemId,
  itemKind,
  libraryId,
  onClose,
}: ImageEditorDialogProps) => {
  const { dialog } = useModal()
  const details = useQuery(itemQuery(itemId))
  const libraries = useQuery(librariesQuery)

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={COMMON_COPY.editImages}
      onClose={onClose}
    >
      {details.data && (
        <ImageEditor
          details={details.data}
          libraries={libraries.data ?? []}
          libraryId={libraryId}
          itemKind={itemKind}
          onDone={onClose}
        />
      )}
      {!details.data && (
        <p className={styles.waiting} role={details.isError ? 'alert' : undefined}>
          {details.isError ? details.error.message : IMAGE_EDITOR_COPY.gathering}
        </p>
      )}
    </dialog>
  )
}
