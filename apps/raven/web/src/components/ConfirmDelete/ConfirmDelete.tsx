import { type MediaItem, mediaLabel } from '@raven/core'
import { useId } from 'react'
import { Button } from '@raven/ui'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { useModal } from '@/lib/useModal'
import styles from '@/components/ConfirmDelete/ConfirmDelete.module.scss'

type ConfirmDeleteProps = {
  media: MediaItem
  onClose: () => void
  onDeleted?: () => void
}

/**
 * Deleting is the one action here that cannot be undone, so it asks first,
 * naming the file since a movie's copies share a title. The delete is
 * held here, so a list of files holds one only while its dialog is open.
 */
export const ConfirmDelete = ({ media, onClose, onDeleted }: ConfirmDeleteProps) => {
  const { dialog } = useModal()
  const { remove } = useMediaMutations({ media })
  const id = useId()

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onClose={onClose}>
      <div className={styles.body}>
        <h2 id={id} className={styles.title}>
          Delete {mediaLabel(media)}?
        </h2>
        <p className={styles.fileName}>{media.fileName}</p>
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
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  onClose()
                  onDeleted?.()
                },
              })
            }
          >
            Delete for good
          </Button>
        </div>
      </div>
    </dialog>
  )
}
