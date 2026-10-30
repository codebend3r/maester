import { type MediaItem, mediaLabel } from '@raven/core'
import { useId } from 'react'
import { Button } from '@raven/ui'
import { CONFIRM_DELETE_COPY } from '@/components/ConfirmDelete/copy'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { useModal } from '@/lib/useModal'
import styles from '@/components/ConfirmDelete/ConfirmDelete.module.scss'
import { COMMON_COPY } from '@/lib/copy'

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
          {CONFIRM_DELETE_COPY.title(mediaLabel(media))}
        </h2>
        <p className={styles.fileName}>{media.fileName}</p>
        <p className={styles.hint}>{CONFIRM_DELETE_COPY.hint}</p>
        {remove.isError && (
          <p role="alert" className={styles.error}>
            {remove.error.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>{COMMON_COPY.cancel}</Button>
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
            {COMMON_COPY.deleteForGood}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
