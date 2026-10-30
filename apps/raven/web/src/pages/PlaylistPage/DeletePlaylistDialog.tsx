import type { PlaylistSummary } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
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

/**
 * Asks before a playlist goes: it cannot be had back, though its tracks stay
 * in their libraries. Confirmed, it leaves the list and the page at once; a
 * refusal puts it back in the list and says so in a toast.
 */
export const DeletePlaylistDialog = ({
  playlist,
  onClose,
  onDeleted,
}: DeletePlaylistDialogProps) => {
  const { dialog, close, keepKeys } = useModal()
  const { remove } = usePlaylistMutations()
  const show = useToasts((state) => state.show)
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
        <div className={styles.actions}>
          <Button onClick={close}>{COMMON_COPY.cancel}</Button>
          <Button
            tone="danger"
            icon="trash"
            onClick={() => {
              remove.attempt({
                variables: playlist.id,
                onRefused: (error) =>
                  show(
                    DELETE_PLAYLIST_COPY.notDeleted({ name: playlist.name, why: error.message }),
                  ),
              })
              onDeleted()
            }}
          >
            {DELETE_PLAYLIST_COPY.confirm}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
