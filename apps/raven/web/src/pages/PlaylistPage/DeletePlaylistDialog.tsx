import type { PlaylistSummary } from '@raven/core'
import { Button } from '@raven/ui'
import { useId } from 'react'
import { useModal } from '@/lib/useModal'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
import { DELETE_PLAYLIST_COPY } from '@/pages/PlaylistPage/copy'
import styles from '@/pages/PlaylistPage/DeletePlaylistDialog.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type DeletePlaylistDialogProps = {
  playlist: PlaylistSummary
  onClose: () => void
  onDeleted: () => void
}

/** Asks before a playlist goes: it cannot be had back, though its tracks stay in their libraries. */
export const DeletePlaylistDialog = ({
  playlist,
  onClose,
  onDeleted,
}: DeletePlaylistDialogProps) => {
  const { dialog, close, keepKeys } = useModal()
  const { remove } = usePlaylistMutations()
  const titleId = useId()
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={keepKeys}
    >
      <div className={styles.body}>
        <h2 id={titleId} className={styles.title}>
          {DELETE_PLAYLIST_COPY.title(playlist.name)}
        </h2>
        <p className={styles.hint}>{DELETE_PLAYLIST_COPY.hint}</p>
        {remove.isError && (
          <p role="alert" className={styles.error}>
            {remove.error.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>{COMMON_COPY.cancel}</Button>
          <Button
            tone="danger"
            icon="trash"
            disabled={remove.isPending}
            onClick={() => remove.mutate(playlist.id, { onSuccess: onDeleted })}
          >
            {DELETE_PLAYLIST_COPY.confirm}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
